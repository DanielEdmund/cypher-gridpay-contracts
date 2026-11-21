import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-sdk";

export type QuotaScope = "customer" | "merchant";

export interface SponsorRequest {
  transactionXdr: string;
  merchantId?: string;
  customerId?: string;
}

export interface SponsorResult {
  hash: string;
  innerHash: string;
  feeStroops: number;
  innerFeeStroops: number;
  incrementalStroops: number;
  channelAccount: string;
  contractIds: string[];
  entrypoints: string[];
}

export interface SimulationCallResult {
  error?: string;
  returnValue?: unknown;
}

export interface SimulatedTransaction {
  error?: string;
  results: SimulationCallResult[];
  restoreRequired: boolean;
  latestLedger?: number;
}

export interface SubmitResult {
  status: string;
  hash?: string;
  errorResult?: unknown;
}

export interface TransactionResult {
  status: string;
  resultXdr?: string;
  latestLedger?: number;
}

export interface AccountState {
  accountId: string;
  sequence: string;
  nativeBalanceStroops: number;
}

export interface SorobanRpc {
  simulateTransaction(transaction: Transaction): Promise<SimulatedTransaction>;
  sendTransaction(transaction: FeeBumpTransaction): Promise<SubmitResult>;
  getTransaction(hash: string): Promise<TransactionResult>;
  getAccount(accountId: string): Promise<AccountState>;
}

export interface QuotaReservation {
  consume(): Promise<void>;
  release(): Promise<void>;
}

export interface QuotaStore {
  reserve(scope: QuotaScope, id: string, amount: number, nowMs?: number): Promise<QuotaReservation>;
}

export interface PolicyDecision {
  transaction: Transaction;
  customer: string;
  contractIds: string[];
  entrypoints: string[];
  simulation: SimulatedTransaction;
  reservations: QuotaReservation[];
}

export interface SponsorSigner {
  sign(transaction: FeeBumpTransaction): Promise<FeeBumpTransaction>;
}

export interface ChannelState {
  accountId: string;
  sequence: string;
}

export interface ChannelLease {
  readonly accountId: string;
  readonly sequence: string;
  readonly settled: boolean;
  succeed(): void;
  fail(reason: string): void;
}

export interface SponsorshipRecord {
  timestamp: string;
  hash: string;
  innerHash: string;
  customer: string;
  merchant?: string;
  contractIds: string[];
  entrypoints: string[];
  feeStroops: number;
  innerFeeStroops: number;
  incrementalStroops: number;
  channelAccount: string;
}

export interface SponsorshipLedger {
  record(record: SponsorshipRecord): Promise<void>;
}

export interface AlertSink {
  alert(message: string, details?: Record<string, unknown>): Promise<void> | void;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface RelayerConfig {
  port: number;
  rpcUrl: string;
  networkPassphrase: string;
  allowedContracts: Set<string>;
  allowedEntrypoints: Set<string>;
  maxSponsoredStroops: number;
  feeBumpBaseFeeStroops: number;
  safetyFloorStroops: number;
  customerDailyLimit: number;
  merchantDailyLimit: number;
  channels: ChannelState[];
  redisUrl?: string;
  redisKeyPrefix: string;
  kmsSignUrl: string;
  kmsKeys: Record<string, string>;
  kmsTimeoutMs: number;
  kmsHeaders: Record<string, string>;
  confirmationTimeoutMs: number;
  pollIntervalMs: number;
  acquireTimeoutMs: number;
  accountingLogPath: string;
  alertWebhookUrl?: string;
  maxBodyBytes: number;
  maxXdrChars: number;
}
