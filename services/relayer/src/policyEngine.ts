import { FeeBumpTransaction, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { BadRequestError, PolicyViolationError } from "./errors.js";
import { normalizeContractId } from "./config.js";
import type {
  PolicyDecision,
  QuotaReservation,
  RelayerConfig,
  SorobanRpc,
  SponsorRequest,
  QuotaStore,
} from "./types.js";

interface HostFunctionLike {
  switch(): { name: string };
  invokeContract(): {
    contractAddress(): { switch(): { name: string }; contractId(): Buffer };
    functionName(): string;
    args(): unknown[];
  };
}

interface InvokeOperationLike {
  type: string;
  func: HostFunctionLike;
}

export interface PolicyEngineDeps {
  rpc: SorobanRpc;
  quotaStore: QuotaStore;
  config: RelayerConfig;
}

export function parseInnerTransaction(xdr: string, networkPassphrase: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (error) {
    throw new BadRequestError("INVALID_XDR", "Unable to parse the supplied transaction XDR", {
      reason: String(error),
    });
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new PolicyViolationError("INNER_FEE_BUMP_REJECTED", "Inner transaction must not be a fee-bump transaction");
  }
  return parsed;
}

export async function releaseReservations(reservations: QuotaReservation[]): Promise<void> {
  for (const reservation of reservations) {
    await reservation.release();
  }
}

export async function consumeReservations(reservations: QuotaReservation[]): Promise<void> {
  for (const reservation of reservations) {
    await reservation.consume();
  }
}

export class PolicyEngine {
  constructor(private readonly deps: PolicyEngineDeps) {}

  async evaluate(request: SponsorRequest): Promise<PolicyDecision> {
    const { config, rpc, quotaStore } = this.deps;
    const transaction = parseInnerTransaction(request.transactionXdr, config.networkPassphrase);
    const operations = transaction.operations ?? [];
    if (operations.length === 0) {
      throw new PolicyViolationError("NO_OPERATIONS", "Inner transaction contains no operations");
    }

    const contractIds: string[] = [];
    const entrypoints: string[] = [];
    for (const operation of operations) {
      const invoke = operation as unknown as InvokeOperationLike;
      if (invoke.type !== "invokeHostFunction") {
        throw new PolicyViolationError("DISALLOWED_OPERATION", "Only InvokeHostFunction operations may be sponsored", {
          type: invoke.type,
        });
      }
      if (invoke.func?.switch?.().name !== "hostFunctionTypeInvokeContract") {
        throw new PolicyViolationError(
          "DISALLOWED_HOST_FUNCTION",
          "Only contract invocations may be sponsored",
          { type: invoke.func?.switch?.().name },
        );
      }
      const args = invoke.func.invokeContract();
      const address = args.contractAddress();
      if (address.switch().name !== "scAddressTypeContract") {
        throw new PolicyViolationError("UNWHITELISTED_CONTRACT", "Host function target is not a contract address");
      }
      const contractId = Buffer.from(address.contractId()).toString("hex");
      if (!config.allowedContracts.has(normalizeContractId(contractId))) {
        throw new PolicyViolationError("UNWHITELISTED_CONTRACT", "Contract target is not whitelisted", {
          contractId,
        });
      }
      const entrypoint = String(args.functionName());
      if (!config.allowedEntrypoints.has(entrypoint)) {
        throw new PolicyViolationError("UNAPPROVED_ENTRYPOINT", "Contract entrypoint is not approved", {
          entrypoint,
        });
      }
      contractIds.push(contractId);
      entrypoints.push(entrypoint);
    }

    const fee = Number(transaction.fee);
    if (!Number.isSafeInteger(fee) || fee < 0) {
      throw new BadRequestError("INVALID_REQUEST", "Inner transaction fee is invalid");
    }
    if (fee > config.maxSponsoredStroops) {
      throw new PolicyViolationError("EXCESSIVE_FEE", "Inner transaction fee exceeds MAX_SPONSORED_STROOPS", {
        fee,
        maximum: config.maxSponsoredStroops,
      });
    }

    const customer = request.customerId ?? transaction.source;
    if (typeof customer !== "string" || !StrKey.isValidEd25519PublicKey(customer)) {
      throw new BadRequestError("INVALID_REQUEST", "Customer identity must be a valid Stellar account address", {
        customer,
      });
    }

    const simulation = await rpc.simulateTransaction(transaction);
    if (simulation.error !== undefined && simulation.error !== "") {
      throw new PolicyViolationError("SIMULATION_FAILED", "Soroban simulation failed", {
        error: simulation.error,
      });
    }
    if (simulation.restoreRequired) {
      throw new PolicyViolationError(
        "SIMULATION_RESTORE_REQUIRED",
        "Transaction requires ledger entry restoration before sponsorship",
      );
    }
    const reverted = simulation.results.find((result) => result.error !== undefined && result.error !== "");
    if (reverted !== undefined) {
      throw new PolicyViolationError("SIMULATION_REVERTED", "Soroban simulation reverted", {
        error: reverted.error,
      });
    }

    const reservations: QuotaReservation[] = [];
    try {
      if (config.customerDailyLimit > 0) {
        reservations.push(await quotaStore.reserve("customer", customer, 1));
      }
      if (request.merchantId !== undefined && config.merchantDailyLimit > 0) {
        reservations.push(await quotaStore.reserve("merchant", request.merchantId, 1));
      }
    } catch (error) {
      await releaseReservations(reservations);
      throw error;
    }

    return {
      transaction,
      customer,
      contractIds,
      entrypoints,
      simulation,
      reservations,
    };
  }
}
