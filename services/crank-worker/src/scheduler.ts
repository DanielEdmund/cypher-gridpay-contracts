import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { beginCircuitProbe, isCircuitBlocked, recordCircuitResult, type CircuitBreakerConfig } from "./circuit-breaker.js";
import { getActionDefinition } from "./executors/index.js";
import type { CrankMetrics } from "./metrics.js";
import type { TaskPipeline } from "./pipeline.js";
import type { CircuitState, ScheduleStore } from "./store/types.js";
import type { CrankTask, ExecutionOutcome } from "./types.js";

export interface WorkerOptions {
  store: ScheduleStore;
  pipeline: TaskPipeline;
  metrics: CrankMetrics;
  owner?: string;
  lookaheadMs: number;
  batchSize: number;
  lockTtlMs: number;
  pollIntervalMs: number;
  circuit: CircuitBreakerConfig;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: (message: string) => void;
}

export interface TaskResult {
  task: CrankTask;
  outcome: ExecutionOutcome;
}

export interface BatchReport {
  dueDepth: number;
  processed: number;
  executed: number;
  skipped: number;
  failed: number;
  permanent: number;
  results: TaskResult[];
}

export function lockKey(task: CrankTask): string {
  return createHash("sha256")
    .update(`${task.contract}\u0000${task.entityId}\u0000${task.actionType}`)
    .digest("hex");
}

export function defaultWorkerOwner(): string {
  return `${hostname()}:${process.pid}:${randomUUID()}`;
}

export class CrankWorker {
  private readonly owner: string;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(private readonly options: WorkerOptions) {
    this.owner = options.owner ?? defaultWorkerOwner();
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.log = options.logger ?? (() => {});
  }

  async runOnce(): Promise<BatchReport> {
    const now = this.now();
    const due = await this.options.store.findDue(now, this.options.lookaheadMs, this.options.batchSize);
    const dueDepth = await this.options.store.countDue(now, this.options.lookaheadMs);
    this.options.metrics.setDueQueueDepth(dueDepth);

    const report: BatchReport = {
      dueDepth,
      processed: 0,
      executed: 0,
      skipped: 0,
      failed: 0,
      permanent: 0,
      results: [],
    };

    for (const task of due) {
      const key = lockKey(task);
      const acquired = await this.options.store.acquireLock(key, this.owner, now, this.options.lockTtlMs);
      if (!acquired) {
        report.skipped += 1;
        this.options.metrics.recordOutcome(task.actionType, {
          status: "skipped",
          reason: "lock_contention",
        });
        continue;
      }

      const started = this.now().getTime();
      let circuitState: CircuitState | undefined;
      let circuitScoped = false;
      try {
        circuitScoped = getActionDefinition(task).circuitScoped && task.subscriptionId !== undefined;
        if (circuitScoped && task.subscriptionId !== undefined) {
          circuitState = await this.options.store.getCircuit(task.subscriptionId);
          if (isCircuitBlocked(circuitState, now)) {
            const outcome: ExecutionOutcome = {
              status: "skipped",
              reason: "circuit_open",
              detail: `subscription ${task.subscriptionId} is in backoff`,
              nextRetryAt: circuitState?.nextProbeAt,
            };
            await this.options.store.recordOutcome(task, outcome, this.now());
            this.record(report, task, outcome, started);
            continue;
          }
          if (circuitState !== undefined) await beginCircuitProbe(this.options.store, circuitState, now);
        }

        let outcome = await this.options.pipeline.execute(task);
        if (circuitScoped && task.subscriptionId !== undefined) {
          await this.updateCircuit(task, circuitState, outcome, now);
        }
        if (outcome.status === "failed" && task.attempts + 1 >= task.maxAttempts) {
          outcome = {
            status: "permanent",
            message: outcome.message,
            code: outcome.code,
            txHash: outcome.txHash,
            gasStroops: outcome.gasStroops,
          };
        }
        await this.options.store.recordOutcome(task, outcome, this.now());
        this.record(report, task, outcome, started);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`crank(task=${task.id}) unexpected error: ${message}`);
        const outcome: ExecutionOutcome = {
          status: "failed",
          kind: "transient",
          message,
          retryAt: new Date(now.getTime() + this.options.circuit.baseBackoffMs),
        };
        await this.options.store.recordOutcome(task, outcome, this.now());
        this.record(report, task, outcome, started);
      } finally {
        await this.options.store.releaseLock(key, this.owner);
      }
    }
    return report;
  }

  async runForever(signal?: AbortSignal): Promise<void> {
    while (signal?.aborted !== true) {
      try {
        const report = await this.runOnce();
        this.log(
          `crank cycle: due=${report.dueDepth} processed=${report.processed} executed=${report.executed} skipped=${report.skipped} failed=${report.failed}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`crank cycle failed: ${message}`);
      }
      await this.sleep(this.options.pollIntervalMs);
    }
  }

  private async updateCircuit(
    task: CrankTask,
    state: CircuitState | undefined,
    outcome: ExecutionOutcome,
    now: Date,
  ): Promise<void> {
    if (task.subscriptionId === undefined) return;
    if (outcome.status === "executed") {
      await recordCircuitResult(this.options.store, task.subscriptionId, state, true, undefined, now, this.options.circuit);
      return;
    }
    if (outcome.status === "failed" && outcome.kind === "deterministic") {
      await recordCircuitResult(
        this.options.store,
        task.subscriptionId,
        state,
        false,
        outcome.message,
        now,
        this.options.circuit,
      );
    }
  }

  private record(report: BatchReport, task: CrankTask, outcome: ExecutionOutcome, started: number): void {
    report.processed += 1;
    if (outcome.status === "executed") report.executed += 1;
    else if (outcome.status === "skipped") report.skipped += 1;
    else if (outcome.status === "permanent") report.permanent += 1;
    else report.failed += 1;
    report.results.push({ task, outcome });
    this.options.metrics.recordOutcome(task.actionType, outcome);
    this.options.metrics.observeExecution(
      task.actionType,
      outcome.status,
      Math.max(0, (this.now().getTime() - started) / 1000),
    );
  }
}
