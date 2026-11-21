import type { ScheduleStore, CircuitState } from "./store/types.js";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  baseBackoffMs: 60_000,
  maxBackoffMs: 3_600_000,
};

export function computeBackoffMs(failures: number, config: CircuitBreakerConfig): number {
  const exponent = Math.max(0, failures - config.failureThreshold);
  const multiplier = Math.pow(2, exponent);
  return Math.min(config.baseBackoffMs * multiplier, config.maxBackoffMs);
}

export function isCircuitBlocked(state: CircuitState | undefined, now: Date): boolean {
  return state !== undefined && state.state === "open" && now.getTime() < state.nextProbeAt.getTime();
}

export async function beginCircuitProbe(
  store: ScheduleStore,
  state: CircuitState,
  now: Date,
): Promise<void> {
  if (state.state !== "open" || now.getTime() < state.nextProbeAt.getTime()) return;
  await store.saveCircuit({ ...state, state: "half_open" });
}

export async function recordCircuitResult(
  store: ScheduleStore,
  subscriptionId: string,
  previous: CircuitState | undefined,
  success: boolean,
  errorMessage: string | undefined,
  now: Date,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
): Promise<void> {
  if (success) {
    await store.saveCircuit({
      subscriptionId,
      state: "closed",
      failures: 0,
      nextProbeAt: new Date(0),
      lastError: undefined,
    });
    return;
  }

  const failures = Math.max(1, (previous?.failures ?? 0) + 1);
  const shouldOpen = previous?.state === "half_open" || failures >= config.failureThreshold;
  await store.saveCircuit({
    subscriptionId,
    state: shouldOpen ? "open" : "closed",
    failures,
    nextProbeAt: shouldOpen ? new Date(now.getTime() + computeBackoffMs(failures, config)) : new Date(0),
    lastError: errorMessage,
  });
}
