import { Pool } from "pg";
import type { CrankTask, CrankTaskInput, ExecutionOutcome } from "../types.js";
import type { CircuitState, CircuitStateValue, ScheduleStore } from "./types.js";

interface ScheduleRow {
  id: string | number;
  contract: CrankTask["contract"];
  contract_id: string;
  entity_id: string;
  action_type: CrankTask["actionType"];
  subscription_id: string | null;
  payload: Record<string, unknown>;
  next_run_at: Date;
  attempts: number | string;
  max_attempts: number | string;
}

export class PostgresScheduleStore implements ScheduleStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
    this.ownsPool = pool === undefined;
  }

  async initialize(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async enqueue(input: CrankTaskInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO crank_schedule
        (contract, contract_id, entity_id, action_type, subscription_id, payload, next_run_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       ON CONFLICT (contract, entity_id, action_type) DO UPDATE SET
         contract_id = EXCLUDED.contract_id,
         subscription_id = EXCLUDED.subscription_id,
         payload = EXCLUDED.payload,
         next_run_at = EXCLUDED.next_run_at,
         attempts = 0,
         max_attempts = EXCLUDED.max_attempts,
         enabled = TRUE,
         completed_at = NULL,
         updated_at = now()`,
      [
        input.contract,
        input.contractId,
        input.entityId,
        input.actionType,
        input.subscriptionId ?? null,
        JSON.stringify(input.payload ?? {}),
        input.nextRunAt ?? new Date(),
        input.maxAttempts ?? 10,
      ],
    );
  }

  async findDue(now: Date, lookaheadMs: number, limit: number): Promise<CrankTask[]> {
    const horizon = new Date(now.getTime() + lookaheadMs);
    const result = await this.pool.query<ScheduleRow>(
      `SELECT id, contract, contract_id, entity_id, action_type, subscription_id,
              payload, next_run_at, attempts, max_attempts
         FROM crank_schedule
        WHERE enabled AND next_run_at <= $1
        ORDER BY next_run_at, id
        LIMIT $2`,
      [horizon, limit],
    );
    return result.rows.map(toTask);
  }

  async countDue(now: Date, lookaheadMs: number): Promise<number> {
    const horizon = new Date(now.getTime() + lookaheadMs);
    const result = await this.pool.query<{ count: string | number }>(
      "SELECT count(*)::int AS count FROM crank_schedule WHERE enabled AND next_run_at <= $1",
      [horizon],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async acquireLock(key: string, owner: string, now: Date, ttlMs: number): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + ttlMs);
    const result = await this.pool.query(
      `INSERT INTO crank_locks (lock_key, owner, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (lock_key) DO UPDATE
         SET owner = EXCLUDED.owner,
             expires_at = EXCLUDED.expires_at,
             acquired_at = now()
       WHERE crank_locks.expires_at < $4
       RETURNING lock_key`,
      [key, owner, expiresAt, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    await this.pool.query("DELETE FROM crank_locks WHERE lock_key = $1 AND owner = $2", [key, owner]);
  }

  async recordOutcome(task: CrankTask, outcome: ExecutionOutcome, now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const update = outcomeUpdate(outcome, now);
      await client.query(
        `UPDATE crank_schedule
            SET attempts = attempts + $2,
                enabled = $3,
                next_run_at = COALESCE($4, next_run_at),
                completed_at = $5,
                last_tx_hash = COALESCE($6, last_tx_hash),
                last_error = $7,
                updated_at = $8
          WHERE id = $1`,
        [
          task.id,
          update.attemptIncrement,
          update.enabled,
          update.nextRunAt,
          update.completedAt,
          update.txHash,
          update.error,
          now,
        ],
      );
      await client.query(
        `INSERT INTO crank_execution_log
          (task_id, action_type, status, tx_hash, gas_stroops, error_code, error_message, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          task.id,
          task.actionType,
          outcome.status === "failed" ? `failed:${outcome.kind}` : outcome.status,
          outcome.status === "executed" ? outcome.txHash : null,
          outcome.status === "executed" || outcome.status === "failed" || outcome.status === "permanent"
            ? (outcome.gasStroops ?? 0)
            : 0,
          outcome.status === "failed" || outcome.status === "permanent" ? (outcome.code ?? null) : null,
          errorMessage(outcome),
          retryTime(outcome),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCircuit(subscriptionId: string): Promise<CircuitState | undefined> {
    const result = await this.pool.query<{
      subscription_id: string;
      state: CircuitStateValue;
      failures: number | string;
      opened_at: Date | null;
      next_probe_at: Date | null;
      last_error: string | null;
    }>(
      `SELECT subscription_id, state, failures, opened_at, next_probe_at, last_error
         FROM crank_circuit_breakers WHERE subscription_id = $1`,
      [subscriptionId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      subscriptionId: row.subscription_id,
      state: row.state,
      failures: Number(row.failures),
      nextProbeAt: row.next_probe_at ?? new Date(0),
      lastError: row.last_error ?? undefined,
    };
  }

  async saveCircuit(state: CircuitState): Promise<void> {
    await this.pool.query(
      `INSERT INTO crank_circuit_breakers
        (subscription_id, state, failures, opened_at, next_probe_at, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (subscription_id) DO UPDATE SET
         state = EXCLUDED.state,
         failures = EXCLUDED.failures,
         opened_at = EXCLUDED.opened_at,
         next_probe_at = EXCLUDED.next_probe_at,
         last_error = EXCLUDED.last_error,
         updated_at = now()`,
      [
        state.subscriptionId,
        state.state,
        state.failures,
        state.state === "closed" ? null : new Date(),
        state.nextProbeAt,
        state.lastError ?? null,
      ],
    );
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}

function toTask(row: ScheduleRow): CrankTask {
  return {
    id: String(row.id),
    contract: row.contract,
    contractId: row.contract_id,
    entityId: row.entity_id,
    actionType: row.action_type,
    subscriptionId: row.subscription_id ?? undefined,
    payload: row.payload ?? {},
    nextRunAt: row.next_run_at,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
  };
}

function retryTime(outcome: ExecutionOutcome): Date | null {
  if (outcome.status === "failed") return outcome.retryAt;
  if (outcome.status === "skipped") return outcome.nextRetryAt ?? null;
  return null;
}

function errorMessage(outcome: ExecutionOutcome): string | null {
  if (outcome.status === "skipped") return outcome.reason;
  if (outcome.status === "executed") return null;
  return outcome.message;
}

function outcomeUpdate(
  outcome: ExecutionOutcome,
  now: Date,
): {
  attemptIncrement: number;
  enabled: boolean;
  nextRunAt: Date | null;
  completedAt: Date | null;
  txHash: string | null;
  error: string | null;
} {
  if (outcome.status === "executed") {
    return {
      attemptIncrement: 1,
      enabled: false,
      nextRunAt: null,
      completedAt: now,
      txHash: outcome.txHash,
      error: null,
    };
  }
  if (outcome.status === "skipped") {
    const completed = outcome.reason === "already_executed";
    return {
      attemptIncrement: completed ? 1 : 0,
      enabled: !completed,
      nextRunAt: outcome.nextRetryAt ?? null,
      completedAt: completed ? now : null,
      txHash: null,
      error: outcome.reason,
    };
  }
  if (outcome.status === "permanent") {
    return {
      attemptIncrement: 1,
      enabled: false,
      nextRunAt: null,
      completedAt: now,
      txHash: null,
      error: outcome.message,
    };
  }
  return {
    attemptIncrement: 1,
    enabled: true,
    nextRunAt: outcome.retryAt,
    completedAt: null,
    txHash: null,
    error: outcome.message,
  };
}
