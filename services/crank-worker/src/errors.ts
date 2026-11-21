import type { FailureKind } from "./types.js";

export const ALREADY_EXECUTED_CODES: ReadonlySet<number> = new Set([
  102, 107, 114, 126, 202, 203, 210, 213, 402, 505, 508, 521, 531, 533,
]);

export const NOT_DUE_CODES: ReadonlySet<number> = new Set([208, 219, 302, 307, 309, 517]);

export const DETERMINISTIC_CODES: ReadonlySet<number> = new Set([
  100, 101, 103, 104, 105, 108, 109, 110, 111, 112, 113, 115, 118, 120, 121,
  122, 123, 124, 125, 200, 201, 204, 205, 206, 207, 209, 211, 212, 214, 215,
  218, 220, 221, 222, 223, 224, 300, 301, 303, 304, 305, 306, 308, 310, 311,
  312, 313, 314, 315, 316, 318, 400, 401, 403, 404, 405, 406, 500, 501, 502,
  503, 504, 506, 507, 510, 511, 512, 513, 514, 515, 516, 518, 519, 520, 522,
  524, 525, 526, 527, 528, 529, 530, 532, 534, 535, 536, 537, 538, 539, 540,
  541,
]);

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /tx_bad_seq/i,
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /fetch failed/i,
  /network/i,
  /rate.?limit/i,
  /\b429\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /unavailable/i,
];

const INSUFFICIENT_BALANCE_PATTERN = /insufficient.{0,32}balance|balance.{0,32}insufficient/i;

const INVALID_TASK_PATTERN = /invalid .{0,24}argument|missing .{0,24}argument|unsupported crank action|requires a (payment|escrow|refund) contract/i;

export function extractErrorCode(message: string): number | undefined {
  const matches = [...message.matchAll(/#(\d{1,4})\b/g)];
  const last = matches.at(-1);
  return last?.[1] === undefined ? undefined : Number(last[1]);
}

export function classifyErrorCode(code: number | undefined, message: string): FailureKind {
  if (code !== undefined) {
    if (ALREADY_EXECUTED_CODES.has(code)) return "already_executed";
    if (NOT_DUE_CODES.has(code)) return "not_due";
  }
  if (INSUFFICIENT_BALANCE_PATTERN.test(message) || INVALID_TASK_PATTERN.test(message)) return "deterministic";
  if (code !== undefined && DETERMINISTIC_CODES.has(code)) return "deterministic";
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) return "transient";
  if (code !== undefined) return "deterministic";
  return "unknown";
}

export function classifyError(error: unknown): { kind: FailureKind; code?: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = extractErrorCode(message);
  return { ...classifyErrorCodeDetails(message, code), code };
}

function classifyErrorCodeDetails(
  message: string,
  code: number | undefined,
): { kind: FailureKind; message: string } {
  return { kind: classifyErrorCode(code, message), message };
}

export function isTransient(kind: FailureKind): boolean {
  return kind === "transient" || kind === "unknown";
}
