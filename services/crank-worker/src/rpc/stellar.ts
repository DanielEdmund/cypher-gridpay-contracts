import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import type {
  ActionDefinition,
  ArgumentValue,
  CrankTask,
  RestorePreamble,
  SimulationResult,
  SubmissionReceipt,
  TransactionStatus,
} from "../types.js";
import type { ChannelAccountPool, ChannelLease, RpcGateway, TransactionFactory, TransactionSigner } from "./types.js";

interface ManagedChannel {
  address: string;
  secret: string;
  sequence?: bigint;
  busy: boolean;
}

class StellarChannelLease implements ChannelLease {
  constructor(
    private readonly pool: StellarChannelAccountPool,
    private readonly channel: ManagedChannel,
  ) {}

  get address(): string {
    return this.channel.address;
  }

  get secret(): string {
    return this.channel.secret;
  }

  nextSequence(): bigint {
    const current = this.channel.sequence ?? 0n;
    this.channel.sequence = current + 1n;
    return current;
  }

  invalidate(): void {
    this.channel.sequence = undefined;
    this.pool.invalidate(this.channel.address);
  }

  async release(): Promise<void> {
    await this.pool.release(this.channel);
  }
}

export class StellarChannelAccountPool implements ChannelAccountPool {
  private readonly channels: ManagedChannel[];
  private cursor = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    secrets: readonly string[],
    private readonly server: rpc.Server,
  ) {
    if (secrets.length === 0) throw new Error("At least one channel account secret is required");
    this.channels = secrets.map((secret) => {
      const keypair = Keypair.fromSecret(secret);
      return { address: keypair.publicKey(), secret, busy: false };
    });
  }

  async acquire(): Promise<ChannelLease> {
    for (;;) {
      const channel = this.pickFreeChannel();
      if (channel !== undefined) {
        channel.busy = true;
        if (channel.sequence === undefined) {
          const account = await this.server.getAccount(channel.address);
          channel.sequence = BigInt(account.sequenceNumber());
        }
        return new StellarChannelLease(this, channel);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  async release(channel: ManagedChannel): Promise<void> {
    channel.busy = false;
    const waiter = this.waiters.shift();
    waiter?.();
  }

  invalidate(address: string): void {
    const channel = this.channels.find((item) => item.address === address);
    if (channel !== undefined) channel.sequence = undefined;
  }

  private pickFreeChannel(): ManagedChannel | undefined {
    for (let offset = 0; offset < this.channels.length; offset += 1) {
      const index = (this.cursor + offset) % this.channels.length;
      const channel = this.channels[index];
      if (channel !== undefined && !channel.busy) {
        this.cursor = (index + 1) % this.channels.length;
        return channel;
      }
    }
    return undefined;
  }

  async close(): Promise<void> {}
}

export class StellarTransactionFactory implements TransactionFactory {
  constructor(
    private readonly networkPassphrase: string,
    private readonly baseFeeStroops: string,
  ) {}

  build(task: CrankTask, definition: ActionDefinition, lease: ChannelLease): Transaction {
    const account = new Account(lease.address, lease.nextSequence().toString());
    const contract = new Contract(task.contractId);
    const args = definition.args(task).map((argument) => toScVal(argument, lease.address));
    return new TransactionBuilder(account, {
      fee: this.baseFeeStroops,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(definition.functionName, ...args))
      .setTimeout(60)
      .build();
  }
}

export class StellarSigner implements TransactionSigner {
  private readonly merchantKeypairs: Keypair[];

  constructor(merchantSecrets: readonly string[]) {
    this.merchantKeypairs = merchantSecrets.map((secret) => Keypair.fromSecret(secret));
  }

  sign(
    transaction: unknown,
    task: CrankTask,
    definition: ActionDefinition,
    lease: ChannelLease,
  ): Transaction {
    const tx = transaction as Transaction;
    tx.sign(Keypair.fromSecret(lease.secret));
    if (definition.requiresMerchantAuth) {
      const expected = definition
        .args(task)
        .find((argument) => argument.kind === "address")?.value;
      for (const keypair of this.merchantKeypairs) {
        if (expected === undefined || keypair.publicKey() === expected) tx.sign(keypair);
      }
    }
    return tx;
  }
}

function isSimulationError(
  simulation: rpc.Api.SimulateTransactionResponse,
): simulation is rpc.Api.SimulateTransactionErrorResponse {
  return "error" in simulation;
}

function isSimulationRestore(
  simulation: rpc.Api.SimulateTransactionResponse,
): simulation is rpc.Api.SimulateTransactionRestoreResponse {
  return "restorePreamble" in simulation;
}

export class StellarRpcGateway implements RpcGateway {
  constructor(
    private readonly server: rpc.Server,
    private readonly networkPassphrase: string,
    private readonly baseFeeStroops: string,
  ) {}

  async simulate(transaction: unknown): Promise<SimulationResult> {
    const simulation = await this.server.simulateTransaction(transaction as Transaction);
    if (isSimulationError(simulation)) {
      return { simulation, gasStroops: 0, error: simulation.error };
    }
    const preamble = isSimulationRestore(simulation) ? simulation.restorePreamble : undefined;
    return {
      simulation,
      gasStroops: Number(simulation.minResourceFee ?? 0),
      restorePreamble:
        preamble === undefined
          ? undefined
          : {
              minResourceFee: preamble.minResourceFee,
              transactionData: preamble.transactionData,
            },
    };
  }

  assemble(transaction: unknown, simulation: SimulationResult): unknown {
    return rpc.assembleTransaction(transaction as Transaction, simulation.simulation as rpc.Api.SimulateTransactionResponse).build();
  }

  async restoreFootprint(lease: ChannelLease, preamble: RestorePreamble): Promise<void> {
    const data = preamble.transactionData as SorobanDataBuilder;
    const restore = new TransactionBuilder(new Account(lease.address, lease.nextSequence().toString()), {
      fee: this.baseFeeStroops,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(Operation.restoreFootprint({}))
      .setSorobanData(data.build())
      .setTimeout(60)
      .build();
    restore.sign(Keypair.fromSecret(lease.secret));
    const result = await this.server.sendTransaction(restore);
    if (result.status === "ERROR" || result.status === "TRY_AGAIN_LATER") {
      throw new Error(`restoreFootprint failed: ${result.status} ${result.errorResult?.toString() ?? ""}`);
    }
    const confirmed = await this.server.pollTransaction(result.hash);
    if (confirmed.status !== "SUCCESS") {
      throw new Error(`restoreFootprint transaction ${result.hash} did not succeed`);
    }
  }

  async submit(transaction: unknown, gasStroops: number): Promise<SubmissionReceipt> {
    const result = await this.server.sendTransaction(transaction as Transaction);
    if (result.status === "ERROR" || result.status === "TRY_AGAIN_LATER") {
      throw new Error(`tx_submit_${result.status}: ${result.errorResult?.toString() ?? ""}`);
    }
    return { hash: result.hash, gasStroops };
  }

  async getTransactionStatus(hash: string): Promise<TransactionStatus> {
    const result = await this.server.getTransaction(hash);
    return result.status as TransactionStatus;
  }
}

function toScVal(argument: ArgumentValue, sourceAddress: string): ReturnType<typeof nativeToScVal> {
  switch (argument.kind) {
    case "source":
      return new Address(sourceAddress).toScVal();
    case "address":
      return new Address(argument.value).toScVal();
    case "u64":
      return nativeToScVal(BigInt(argument.value), { type: "u64" });
    case "i128":
      return nativeToScVal(BigInt(argument.value), { type: "i128" });
    case "symbol":
      return nativeToScVal(argument.value, { type: "symbol" });
  }
}

export function createStellarStack(
  config: {
    rpcUrl: string;
    networkPassphrase: string;
    baseFeeStroops: string;
    channelSecrets: readonly string[];
    merchantSecrets: readonly string[];
  },
): {
  server: rpc.Server;
  pool: StellarChannelAccountPool;
  rpcGateway: StellarRpcGateway;
  txFactory: StellarTransactionFactory;
  signer: StellarSigner;
} {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const pool = new StellarChannelAccountPool(config.channelSecrets, server);
  return {
    server,
    pool,
    rpcGateway: new StellarRpcGateway(server, config.networkPassphrase, config.baseFeeStroops),
    txFactory: new StellarTransactionFactory(config.networkPassphrase, config.baseFeeStroops),
    signer: new StellarSigner(config.merchantSecrets),
  };
}
