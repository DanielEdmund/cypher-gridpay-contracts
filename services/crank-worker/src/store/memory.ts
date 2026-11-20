import type { CrankTask, CrankTaskInput, ExecutionOutcome } from "../types.js";
import type { CircuitState, ScheduleStore } from "./types.js";

interface StoredTask extends CrankTask {
  enabled: boolean;
  completedAt?: Date;
  lastTxHash?: string;
  lastError?: string;
}

interface StoredLock {
  owner: string;
  expiresAt: Date;
}

export interface ExecutionLogEntry {
  taskId: string;
  actionType: string;
  status: string;
  txHash?: string;
  gasStroops: number;
  errorCode?: number;
  errorMessage?: string;
  nextRetryAt?: Date;
  attemptedAt: Date;
}

export class MemoryScheduleStore implements ScheduleStore {
  readonly tasks = new Map<string, StoredTask>();
  readonly circuits = new Map<string, CircuitState>();
  readonly locks = new Map<string, StoredLock>();
  readonly executionLog: ExecutionLogEntry[] = [];

  private sequence = 0;

  async initialize(): Promise<void> {}

  async enqueue(input: CrankTaskInput): Promise<void> {
    const key = `${input.contract}\u0000${input.entityId}\u0000${input.actionType}`;
    for (const task of this.tasks.values()) {
      if (this.taskKey(task) === key) {
        const updated: StoredTask = {
          ...task,
          contractId: input.contractId,
          subscriptionId: input.subscriptionId,
          payload: { ...input.payload },
          nextRunAt: input.nextRunAt ?? new Date(),
          attempts: 0,
          maxAttempts: input.maxAttempts ?? task.maxAttempts,
          enabled: true,
          completedAt: undefined,
        };
        this.tasks.set(task.id, updated);
        return;
      }
    }
    this.sequence += 1;
    const id = String(this.sequence);
    this.tasks.set(id, {
      id,
      contract: input.contract,
      contractId: input.contractId,
      entityId: input.entityId,
      actionType: input.actionType,
      subscriptionId: input.subscriptionId,
      payload: { ...input.payload },
      nextRunAt: input.nextRunAt ?? new Date(),
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? 10,
      enabled: true,
    });
  }

  async findDue(now: Date, lookaheadMs: number, limit: number): Promise<CrankTask[]> {
    const horizon = new Date(now.getTime() + lookaheadMs);
    return [...this.tasks.values()]
      .filter((task) => task.enabled && task.nextRunAt.getTime() <= horizon.getTime())
      .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((task) => this.copy(task));
  }

  async countDue(now: Date, lookaheadMs: number): Promise<number> {
    const horizon = new Date(now.getTime() + lookaheadMs);
    return [...this.tasks.values()].filter(
      (task) => task.enabled && task.nextRunAt.getTime() <= horizon.getTime(),
    ).length;
  }

  async acquireLock(key: string, owner: string, now: Date, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing !== undefined && existing.expiresAt.getTime() > now.getTime()) return false;
    this.locks.set(key, { owner, expiresAt: new Date(now.getTime() + ttlMs) });
    return true;
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    const existing = this.locks.get(key);
    if (existing?.owner === owner) this.locks.delete(key);
  }

  async recordOutcome(task: CrankTask, outcome: ExecutionOutcome, now: Date): Promise<void> {
    const stored = this.tasks.get(task.id);
    if (stored === undefined) return;
    const updated: StoredTask = { ...stored, attempts: stored.attempts + 1 };

    if (outcome.status === "executed") {
      updated.enabled = false;
      updated.completedAt = now;
      updated.lastTxHash = outcome.txHash;
      updated.lastError = undefined;
    } else if (outcome.status === "skipped") {
      if (outcome.reason === "already_executed") {
        updated.enabled = false;
        updated.completedAt = now;
      } else {
        updated.nextRunAt = outcome.nextRetryAt ?? new Date(now.getTime() + 60_000);
      }
    } else if (outcome.status === "failed") {
      updated.nextRunAt = outcome.retryAt;
      updated.lastError = outcome.message;
      if (updated.attempts >= updated.maxAttempts) updated.enabled = false;
    } else {
      updated.enabled = false;
      updated.lastError = outcome.message;
      updated.completedAt = now;
    }

    this.tasks.set(task.id, updated);
    this.executionLog.push({
      taskId: task.id,
      actionType: task.actionType,
      status: outcome.status === "failed" ? `failed:${outcome.kind}` : outcome.status,
      txHash: outcome.status === "executed" ? outcome.txHash : undefined,
      gasStroops:
        outcome.status === "executed" || outcome.status === "failed" || outcome.status === "permanent"
          ? (outcome.gasStroops ?? 0)
          : 0,
      errorCode: outcome.status === "failed" || outcome.status === "permanent" ? outcome.code : undefined,
      errorMessage:
        outcome.status === "skipped"
          ? outcome.reason
          : outcome.status === "executed"
            ? undefined
            : outcome.message,
      nextRetryAt:
        outcome.status === "failed"
          ? outcome.retryAt
          : outcome.status === "skipped"
            ? outcome.nextRetryAt
            : undefined,
      attemptedAt: now,
    });
  }

  async getCircuit(subscriptionId: string): Promise<CircuitState | undefined> {
    const state = this.circuits.get(subscriptionId);
    return state === undefined ? undefined : { ...state };
  }

  async saveCircuit(state: CircuitState): Promise<void> {
    this.circuits.set(state.subscriptionId, { ...state });
  }

  async close(): Promise<void> {}

  private taskKey(task: CrankTask): string {
    return `${task.contract}\u0000${task.entityId}\u0000${task.actionType}`;
  }

  private copy(task: StoredTask): CrankTask {
    return {
      id: task.id,
      contract: task.contract,
      contractId: task.contractId,
      entityId: task.entityId,
      actionType: task.actionType,
      subscriptionId: task.subscriptionId,
      payload: { ...task.payload },
      nextRunAt: task.nextRunAt,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
    };
  }
}
