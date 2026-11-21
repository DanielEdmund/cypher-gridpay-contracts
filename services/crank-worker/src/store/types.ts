import type { CrankTask, CrankTaskInput, ExecutionOutcome } from "../types.js";

export type CircuitStateValue = "closed" | "open" | "half_open";

export interface CircuitState {
  subscriptionId: string;
  state: CircuitStateValue;
  failures: number;
  nextProbeAt: Date;
  lastError?: string;
}

export interface ScheduleStore {
  initialize(): Promise<void>;
  enqueue(input: CrankTaskInput): Promise<void>;
  findDue(now: Date, lookaheadMs: number, limit: number): Promise<CrankTask[]>;
  countDue(now: Date, lookaheadMs: number): Promise<number>;
  acquireLock(key: string, owner: string, now: Date, ttlMs: number): Promise<boolean>;
  releaseLock(key: string, owner: string): Promise<void>;
  recordOutcome(task: CrankTask, outcome: ExecutionOutcome, now: Date): Promise<void>;
  getCircuit(subscriptionId: string): Promise<CircuitState | undefined>;
  saveCircuit(state: CircuitState): Promise<void>;
  close(): Promise<void>;
}
