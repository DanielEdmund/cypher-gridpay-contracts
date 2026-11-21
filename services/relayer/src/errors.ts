export type RelayerErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_XDR"
  | "INNER_FEE_BUMP_REJECTED"
  | "NO_OPERATIONS"
  | "DISALLOWED_OPERATION"
  | "DISALLOWED_HOST_FUNCTION"
  | "UNWHITELISTED_CONTRACT"
  | "UNAPPROVED_ENTRYPOINT"
  | "EXCESSIVE_FEE"
  | "SIMULATION_FAILED"
  | "SIMULATION_REVERTED"
  | "SIMULATION_RESTORE_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "INSUFFICIENT_RELAYER_BALANCE"
  | "NO_AVAILABLE_CHANNEL"
  | "SUBMISSION_FAILED"
  | "BAD_SEQUENCE"
  | "CONFIRMATION_TIMEOUT"
  | "ON_LEDGER_FAILURE"
  | "INTERNAL_ERROR";

export class RelayerError extends Error {
  readonly code: RelayerErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: RelayerErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RelayerError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class BadRequestError extends RelayerError {
  constructor(code: RelayerErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, 400, details);
  }
}

export class PolicyViolationError extends RelayerError {
  constructor(code: RelayerErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, 403, details);
  }
}

export class SafetyHaltError extends RelayerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INSUFFICIENT_RELAYER_BALANCE", message, 503, details);
  }
}

export class ChannelUnavailableError extends RelayerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("NO_AVAILABLE_CHANNEL", message, 503, details);
  }
}

export class SubmissionError extends RelayerError {
  constructor(code: "SUBMISSION_FAILED" | "BAD_SEQUENCE", message: string, details?: Record<string, unknown>) {
    super(code, message, 502, details);
  }
}

export class ConfirmationError extends RelayerError {
  constructor(
    code: "CONFIRMATION_TIMEOUT" | "ON_LEDGER_FAILURE",
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, 504, details);
  }
}

export class InternalError extends RelayerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INTERNAL_ERROR", message, 500, details);
  }
}
