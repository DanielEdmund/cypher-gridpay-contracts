import { FeeBumpTransaction, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { parseSponsorRequest } from "./config.js";
import { ChannelPool } from "./channelPool.js";
import {
  ConfirmationError,
  PolicyViolationError,
  RelayerError,
  SafetyHaltError,
  SubmissionError,
} from "./errors.js";
import { consumeReservations, PolicyEngine, releaseReservations } from "./policyEngine.js";
import type {
  AlertSink,
  Logger,
  RelayerConfig,
  SorobanRpc,
  SponsorResult,
  SponsorSigner,
  SponsorshipLedger,
} from "./types.js";

export type BuildFeeBump = (
  inner: Transaction,
  feeSource: string,
  baseFee: string,
  networkPassphrase: string,
) => FeeBumpTransaction;

export interface RelayerDeps {
  config: RelayerConfig;
  policy: PolicyEngine;
  pool: ChannelPool;
  rpc: SorobanRpc;
  signer: SponsorSigner;
  ledger: SponsorshipLedger;
  alerts: AlertSink;
  logger: Logger;
  buildFeeBump?: BuildFeeBump;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function isBadSequence(errorResult: unknown, status: string): boolean {
  if (status === "tx_bad_seq") return true;
  if (typeof errorResult === "string") return errorResult.includes("tx_bad_seq");
  return JSON.stringify(errorResult ?? "").includes("tx_bad_seq");
}

export class RelayerService {
  private readonly buildBump: BuildFeeBump;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly deps: RelayerDeps) {
    this.buildBump = deps.buildFeeBump ?? ((inner, feeSource, baseFee, passphrase) =>
      TransactionBuilder.buildFeeBumpTransaction(feeSource, baseFee, inner, passphrase));
    this.sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  private createFeeBump(inner: Transaction, feeSource: string): FeeBumpTransaction {
    const bump = this.buildBump(
      inner,
      feeSource,
      String(this.deps.config.feeBumpBaseFeeStroops),
      this.deps.config.networkPassphrase,
    );
    const totalFee = Number(bump.fee);
    if (!Number.isSafeInteger(totalFee) || totalFee > this.deps.config.maxSponsoredStroops) {
      throw new PolicyViolationError("EXCESSIVE_FEE", "Fee-bump total exceeds MAX_SPONSORED_STROOPS", {
        fee: totalFee,
        maximum: this.deps.config.maxSponsoredStroops,
      });
    }
    return bump;
  }

  private async confirm(hash: string): Promise<"SUCCESS" | "FAILED" | "TIMEOUT"> {
    const deadline = Date.now() + this.deps.config.confirmationTimeoutMs;
    for (;;) {
      const result = await this.deps.rpc.getTransaction(hash);
      if (result.status === "SUCCESS") return "SUCCESS";
      if (result.status === "FAILED") return "FAILED";
      if (Date.now() >= deadline) return "TIMEOUT";
      await this.sleep(this.deps.config.pollIntervalMs);
    }
  }

  async sponsor(payload: unknown): Promise<SponsorResult> {
    const request = parseSponsorRequest(payload, this.deps.config.maxXdrChars);
    const decision = await this.deps.policy.evaluate(request);
    const lease = await this.deps.pool.acquire();
    let quotasCommitted = false;

    try {
      const account = await this.deps.rpc.getAccount(lease.accountId);
      this.deps.pool.setSequence(lease.accountId, account.sequence);
      if (account.nativeBalanceStroops < this.deps.config.safetyFloorStroops) {
        await this.deps.alerts.alert("Relayer balance below safety floor; sponsorship halted", {
          accountId: lease.accountId,
          nativeBalanceStroops: account.nativeBalanceStroops,
          safetyFloorStroops: this.deps.config.safetyFloorStroops,
        });
        throw new SafetyHaltError("Relayer account balance is below the configured safety floor", {
          accountId: lease.accountId,
        });
      }

      let bump = this.createFeeBump(decision.transaction, lease.accountId);
      let signed = await this.deps.signer.sign(bump);
      let submission = await this.deps.rpc.sendTransaction(signed);

      if (isBadSequence(submission.errorResult, submission.status)) {
        await this.deps.pool.refresh(lease.accountId, "tx_bad_seq");
        bump = this.createFeeBump(decision.transaction, lease.accountId);
        signed = await this.deps.signer.sign(bump);
        submission = await this.deps.rpc.sendTransaction(signed);
        if (isBadSequence(submission.errorResult, submission.status)) {
          throw new SubmissionError("BAD_SEQUENCE", "Fee-bump submission hit tx_bad_seq after a retry", {
            hash: submission.hash,
          });
        }
      }

      if (submission.status !== "PENDING" || submission.hash === undefined) {
        throw new SubmissionError("SUBMISSION_FAILED", "Soroban RPC did not accept the fee-bump transaction", {
          status: submission.status,
          errorResult: submission.errorResult,
        });
      }

      const confirmation = await this.confirm(submission.hash);
      if (confirmation === "FAILED") {
        throw new ConfirmationError("ON_LEDGER_FAILURE", "Sponsored transaction failed on-ledger", {
          hash: submission.hash,
        });
      }
      if (confirmation === "TIMEOUT") {
        throw new ConfirmationError("CONFIRMATION_TIMEOUT", "Timed out waiting for sponsored transaction", {
          hash: submission.hash,
        });
      }

      const feeStroops = Number(bump.fee);
      const innerFeeStroops = Number(decision.transaction.fee);
      const record = {
        timestamp: new Date().toISOString(),
        hash: submission.hash,
        innerHash: decision.transaction.hash().toString("hex"),
        customer: decision.customer,
        ...(request.merchantId === undefined ? {} : { merchant: request.merchantId }),
        contractIds: decision.contractIds,
        entrypoints: decision.entrypoints,
        feeStroops,
        innerFeeStroops,
        incrementalStroops: feeStroops - innerFeeStroops,
        channelAccount: lease.accountId,
      };
      await this.deps.ledger.record(record);
      await consumeReservations(decision.reservations);
      quotasCommitted = true;
      lease.succeed();
      this.deps.logger.info("sponsorship confirmed", record);

      return {
        hash: record.hash,
        innerHash: record.innerHash,
        feeStroops,
        innerFeeStroops,
        incrementalStroops: record.incrementalStroops,
        channelAccount: lease.accountId,
        contractIds: decision.contractIds,
        entrypoints: decision.entrypoints,
      };
    } catch (error) {
      if (!quotasCommitted) await releaseReservations(decision.reservations);
      lease.fail(error instanceof RelayerError ? error.code : "INTERNAL_ERROR");
      this.deps.logger.error("sponsorship rejected", {
        error: String(error),
        contractIds: decision.contractIds,
        entrypoints: decision.entrypoints,
      });
      throw error;
    }
  }
}
