import type {
  ActionDefinition,
  CrankTask,
  RestorePreamble,
  SimulationResult,
  SubmissionReceipt,
  TransactionStatus,
} from "../types.js";

export interface ChannelLease {
  readonly address: string;
  readonly secret: string;
  nextSequence(): bigint;
  invalidate(): void;
  release(): Promise<void>;
}

export interface ChannelAccountPool {
  acquire(): Promise<ChannelLease>;
  close(): Promise<void>;
}

export interface RpcGateway {
  simulate(transaction: unknown): Promise<SimulationResult>;
  assemble(transaction: unknown, simulation: SimulationResult): unknown;
  restoreFootprint(lease: ChannelLease, preamble: RestorePreamble): Promise<void>;
  submit(transaction: unknown, gasStroops: number): Promise<SubmissionReceipt>;
  getTransactionStatus(hash: string): Promise<TransactionStatus>;
}

export interface TransactionFactory {
  build(task: CrankTask, definition: ActionDefinition, lease: ChannelLease): unknown;
}

export interface TransactionSigner {
  sign(
    transaction: unknown,
    task: CrankTask,
    definition: ActionDefinition,
    lease: ChannelLease,
  ): Promise<unknown> | unknown;
}
