import {
  Account,
  Asset,
  Contract,
  Keypair,
  Operation,
  Networks,
  StrKey,
  TimeoutInfinite,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { InMemoryQuotaStore } from "../dist/quotaStore.js";
import { ChannelPool } from "../dist/channelPool.js";
import { PolicyEngine } from "../dist/policyEngine.js";
import { RelayerService } from "../dist/relayer.js";

export const PASSPHRASE = Networks.TESTNET;
export const CONTRACT_HEX = "07".repeat(32);
export const CONTRACT_ID = StrKey.encodeContract(Buffer.from(CONTRACT_HEX, "hex"));
export const OTHER_CONTRACT_HEX = "09".repeat(32);
export const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.from(OTHER_CONTRACT_HEX, "hex"));

export function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

export function makeConfig(overrides = {}) {
  const testKeypairs = overrides.testKeypairs ?? [Keypair.random(), Keypair.random()];
  const channels = overrides.channels ?? testKeypairs.map((keypair) => ({
    accountId: keypair.publicKey(),
    sequence: "1",
  }));
  return {
    port: 8080,
    rpcUrl: "http://127.0.0.1:8000",
    networkPassphrase: PASSPHRASE,
    allowedContracts: new Set([CONTRACT_HEX]),
    allowedEntrypoints: new Set(["create_payment", "pay_installment", "claim_rebate"]),
    maxSponsoredStroops: 200_000,
    feeBumpBaseFeeStroops: 100,
    safetyFloorStroops: 0,
    customerDailyLimit: 10,
    merchantDailyLimit: 100,
    channels,
    redisKeyPrefix: "relayer:quota",
    kmsSignUrl: "http://127.0.0.1:9000/sign",
    kmsKeys: Object.fromEntries(channels.map((channel) => [channel.accountId, "key-id"])),
    kmsTimeoutMs: 1000,
    kmsHeaders: {},
    confirmationTimeoutMs: 200,
    pollIntervalMs: 1,
    acquireTimeoutMs: 100,
    accountingLogPath: "sponsorships.jsonl",
    maxBodyBytes: 1_048_576,
    maxXdrChars: 262_144,
    testKeypairs,
    ...overrides,
  };
}

export function makeInnerTransaction({
  contractId = CONTRACT_ID,
  entrypoint = "create_payment",
  fee = "100",
  sequence = "1",
  operations,
} = {}) {
  const contract = new Contract(contractId);
  const ops = operations ?? [
    contract.call(entrypoint, xdr.ScVal.scvU64(xdr.Uint64.fromString("1"))),
  ];
  const source = Keypair.random();
  const builder = new TransactionBuilder(new Account(source.publicKey(), sequence), {
    fee,
    networkPassphrase: PASSPHRASE,
  });
  for (const op of ops) builder.addOperation(op);
  return { transaction: builder.setTimeout(TimeoutInfinite).build(), source };
}

export function makePaymentOperation() {
  return Operation.payment({
    destination: Keypair.random().publicKey(),
    asset: Asset.native(),
    amount: "1",
  });
}

export class FakeRpc {
  constructor(overrides = {}) {
    this.simulations = [];
    this.submissions = [];
    this.accountReads = [];
    this.getTransactionCalls = [];
    this.simulationResult = overrides.simulationResult ?? { results: [{}], restoreRequired: false };
    this.accountResult = overrides.accountResult ?? {
      accountId: "GACCOUNT",
      sequence: "1",
      nativeBalanceStroops: 100_000_000,
    };
    this.sendResult = overrides.sendResult ?? { status: "PENDING", hash: "hash-1" };
    this.transactionResult = overrides.transactionResult ?? { status: "SUCCESS", resultXdr: "result" };
    this.sendHandler = overrides.sendHandler;
    this.accountHandler = overrides.accountHandler;
  }

  async simulateTransaction(transaction) {
    this.simulations.push(transaction);
    if (typeof this.simulationResult === "function") return this.simulationResult(transaction);
    return this.simulationResult;
  }

  async sendTransaction(transaction) {
    this.submissions.push(transaction);
    if (this.sendHandler !== undefined) return this.sendHandler(transaction, this.submissions.length);
    return this.sendResult;
  }

  async getTransaction(hash) {
    this.getTransactionCalls.push(hash);
    return this.transactionResult;
  }

  async getAccount(accountId) {
    this.accountReads.push(accountId);
    if (this.accountHandler !== undefined) return this.accountHandler(accountId);
    return { ...this.accountResult, accountId };
  }
}

export class LocalSigner {
  constructor(keypairs) {
    this.keypairs = new Map(keypairs.map((keypair) => [keypair.publicKey(), keypair]));
  }

  async sign(transaction) {
    const keypair = this.keypairs.get(transaction.feeSource);
    if (keypair === undefined) throw new Error(`No local key for ${transaction.feeSource}`);
    transaction.sign(keypair);
    return transaction;
  }
}

export class MemoryLedger {
  constructor() {
    this.records = [];
  }

  async record(record) {
    this.records.push(record);
  }
}

export class MemoryAlerts {
  constructor() {
    this.messages = [];
  }

  alert(message, details) {
    this.messages.push({ message, details });
  }
}

export function makePolicy(config, rpc, quotaStore) {
  return new PolicyEngine({
    config,
    rpc,
    quotaStore: quotaStore ?? new InMemoryQuotaStore(
      { customer: config.customerDailyLimit, merchant: config.merchantDailyLimit },
      config.redisKeyPrefix,
    ),
  });
}

export function makeRelayer({
  config = makeConfig(),
  rpc = new FakeRpc(),
  quotaStore = new InMemoryQuotaStore(
    { customer: config.customerDailyLimit, merchant: config.merchantDailyLimit },
    config.redisKeyPrefix,
  ),
  ledger = new MemoryLedger(),
  alerts = new MemoryAlerts(),
  channelKeypairs,
} = {}) {
  const keypairs = channelKeypairs ?? config.testKeypairs ?? config.channels.map(() => Keypair.random());
  const signer = {
    async sign(transaction) {
      const keypair = keypairs.find((candidate) => candidate.publicKey() === transaction.feeSource);
      if (keypair === undefined) throw new Error(`No signer for ${transaction.feeSource}`);
      transaction.sign(keypair);
      return transaction;
    },
  };
  const pool = new ChannelPool(config.channels, { rpc, logger: silentLogger(), acquireTimeoutMs: 1000 });
  const service = new RelayerService({
    config,
    policy: makePolicy(config, rpc, quotaStore),
    pool,
    rpc,
    signer,
    ledger,
    alerts,
    logger: silentLogger(),
    sleep: async () => {},
  });
  return { service, pool, rpc, ledger, alerts, quotaStore, keypairs };
}
