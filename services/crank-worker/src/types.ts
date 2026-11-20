export type ContractKind = "payment" | "escrow" | "refund";

export type ActionType =
  | "execute_scheduled_payment"
  | "execute_recurring_payment"
  | "execute_metered_billing"
  | "retry_failed_payment"
  | "emit_trial_conversion_notice"
  | "trigger_scheduled_payout"
  | "expire_payment"
  | "trigger_arbitration_timeout"
  | "cleanup_stale_escrow";

export type FailureKind =
  | "already_executed"
  | "not_due"
  | "deterministic"
  | "transient"
  | "circuit_open"
  | "unknown";

export interface CrankTaskInput {
  contract: ContractKind;
  contractId: string;
  entityId: string;
  actionType: ActionType;
  subscriptionId?: string;
  payload?: Record<string, unknown>;
  nextRunAt?: Date;
  attempts?: number;
  maxAttempts?: number;
}

export interface CrankTask {
  id: string;
  contract: ContractKind;
  contractId: string;
  entityId: string;
  actionType: ActionType;
  subscriptionId?: string;
  payload: Record<string, unknown>;
  nextRunAt: Date;
  attempts: number;
  maxAttempts: number;
}

export interface ArgumentValue {
  kind: "u64" | "i128" | "address" | "symbol" | "source";
  value: string;
}

export interface ActionDefinition {
  actionType: ActionType;
  contract: ContractKind;
  functionName: string;
  args(task: CrankTask): ArgumentValue[];
  requiresMerchantAuth: boolean;
  circuitScoped: boolean;
}

export type ExecutionOutcome =
  | { status: "executed"; txHash: string; gasStroops: number }
  | {
      status: "skipped";
      reason: "already_executed" | "not_due" | "circuit_open" | "lock_contention";
      detail?: string;
      nextRetryAt?: Date;
    }
  | {
      status: "failed";
      kind: "transient" | "deterministic";
      code?: number;
      message: string;
      retryAt: Date;
      txHash?: string;
      gasStroops?: number;
    }
  | { status: "permanent"; code?: number; message: string; txHash?: string; gasStroops?: number };

export interface SimulationResult {
  simulation: unknown;
  restorePreamble?: unknown;
  gasStroops: number;
  error?: string;
}

export interface SubmissionReceipt {
  hash: string;
  gasStroops: number;
}

export type TransactionStatus = "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND";

export interface RestorePreamble {
  minResourceFee: string;
  transactionData: unknown;
}
