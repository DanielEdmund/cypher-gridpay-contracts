import type { CrankConfig } from "./config.js";
import { retryDelayMs } from "./config.js";
import { classifyError, isTransient } from "./errors.js";
import { getActionDefinition } from "./executors/index.js";
import type { ChannelAccountPool, ChannelLease, RpcGateway, TransactionFactory, TransactionSigner } from "./rpc/types.js";
import type {
  ActionDefinition,
  CrankTask,
  ExecutionOutcome,
  FailureKind,
  RestorePreamble,
  SimulationResult,
  TransactionStatus,
} from "./types.js";

export interface PipelineConfig {
  baseRetryMs: number;
  maxRetryMs: number;
  pollAttempts: number;
  pollInitialDelayMs: number;
  pollMaxDelayMs: number;
  maxRestoreAttempts: number;
}

export interface PipelineOptions {
  rpc: RpcGateway;
  txFactory: TransactionFactory;
  signer: TransactionSigner;
  pool: ChannelAccountPool;
  config: PipelineConfig | CrankConfig;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

function hasRestore(simulation: SimulationResult): simulation is SimulationResult & { restorePreamble: RestorePreamble } {
  return simulation.restorePreamble !== undefined;
}

function isBadSequence(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /tx_bad_seq|bad_seq/i.test(message);
}

function withTransactionDetails(outcome: ExecutionOutcome, txHash: string, gasStroops: number): ExecutionOutcome {
  if (outcome.status === "failed" || outcome.status === "permanent") {
    return { ...outcome, txHash, gasStroops };
  }
  return outcome;
}

export class SimulateFirstPipeline {
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: PipelineOptions) {
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date());
  }

  async execute(task: CrankTask): Promise<ExecutionOutcome> {
    let lease: ChannelLease | undefined;
    try {
      const definition = getActionDefinition(task);
      lease = await this.options.pool.acquire();
      return await this.executeWithLease(task, definition, lease);
    } catch (error) {
      const classified = classifyError(error);
      if (classified.kind === "already_executed") {
        return { status: "skipped", reason: "already_executed", detail: classified.message };
      }
      if (classified.kind === "not_due") {
        return {
          status: "skipped",
          reason: "not_due",
          detail: classified.message,
          nextRetryAt: new Date(this.now().getTime() + retryDelayMs(task.attempts + 1, this.options.config, false)),
        };
      }
      return this.failure(task, classified.kind, classified.code, classified.message);
    } finally {
      await lease?.release();
    }
  }

  private async executeWithLease(
    task: CrankTask,
    definition: ActionDefinition,
    lease: ChannelLease,
  ): Promise<ExecutionOutcome> {
    for (let sequenceAttempt = 0; sequenceAttempt <= 1; sequenceAttempt += 1) {
      let raw = this.options.txFactory.build(task, definition, lease);
      let simulation = await this.options.rpc.simulate(raw);
      let restores = 0;

      while (
        simulation.error === undefined &&
        hasRestore(simulation) &&
        restores < this.options.config.maxRestoreAttempts
      ) {
        await this.options.rpc.restoreFootprint(lease, simulation.restorePreamble);
        restores += 1;
        raw = this.options.txFactory.build(task, definition, lease);
        simulation = await this.options.rpc.simulate(raw);
      }

      if (simulation.error !== undefined) {
        const classified = classifyError(simulation.error);
        if (classified.kind === "already_executed") {
          return { status: "skipped", reason: "already_executed", detail: simulation.error };
        }
        if (classified.kind === "not_due") {
          return {
            status: "skipped",
            reason: "not_due",
            detail: simulation.error,
            nextRetryAt: new Date(this.now().getTime() + retryDelayMs(task.attempts + 1, this.options.config, false)),
          };
        }
        return this.failure(task, classified.kind, classified.code, simulation.error);
      }

      if (hasRestore(simulation)) {
        return this.failure(task, "transient", undefined, "TTL restore limit exceeded before submission");
      }

      const assembled = this.options.rpc.assemble(raw, simulation);
      const signed = await this.options.signer.sign(assembled, task, definition, lease);
      let receipt;
      try {
        receipt = await this.options.rpc.submit(signed, simulation.gasStroops);
      } catch (error) {
        if (isBadSequence(error) && sequenceAttempt === 0) {
          lease.invalidate();
          continue;
        }
        const classified = classifyError(error);
        return this.failure(task, classified.kind, classified.code, classified.message);
      }

      const status = await this.poll(receipt.hash);
      if (status === "SUCCESS") {
        return { status: "executed", txHash: receipt.hash, gasStroops: receipt.gasStroops };
      }
      if (status === "FAILED") {
        return withTransactionDetails(
          this.failure(task, "deterministic", undefined, `Transaction ${receipt.hash} failed on ledger`),
          receipt.hash,
          receipt.gasStroops,
        );
      }
      return withTransactionDetails(
        this.failure(task, "transient", undefined, `Transaction ${receipt.hash} still pending`),
        receipt.hash,
        receipt.gasStroops,
      );
    }
    return this.failure(task, "transient", undefined, "Channel account sequence could not be synchronized");
  }

  private async poll(hash: string): Promise<TransactionStatus> {
    let delay = this.options.config.pollInitialDelayMs;
    for (let attempt = 0; attempt < this.options.config.pollAttempts; attempt += 1) {
      const status = await this.options.rpc.getTransactionStatus(hash);
      if (status === "SUCCESS" || status === "FAILED") return status;
      await this.sleep(delay);
      delay = Math.min(delay * 2, this.options.config.pollMaxDelayMs);
    }
    return "PENDING";
  }

  private failure(
    task: CrankTask,
    kind: FailureKind,
    code: number | undefined,
    message: string,
  ): ExecutionOutcome {
    const deterministic = kind === "deterministic";
    const retryAt = new Date(
      this.now().getTime() + retryDelayMs(task.attempts + 1, this.options.config, deterministic),
    );
    return {
      status: "failed",
      kind: isTransient(kind) ? "transient" : "deterministic",
      code,
      message,
      retryAt,
    };
  }
}

export type TaskPipeline = Pick<SimulateFirstPipeline, "execute">;
