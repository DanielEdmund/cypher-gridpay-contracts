import { SimulateFirstPipeline } from "../dist/pipeline.js";

export const TEST_CONFIG = {
  baseRetryMs: 1_000,
  maxRetryMs: 60_000,
  pollAttempts: 2,
  pollInitialDelayMs: 0,
  pollMaxDelayMs: 0,
  maxRestoreAttempts: 2,
};

export const TEST_CIRCUIT = {
  failureThreshold: 3,
  baseBackoffMs: 10_000,
  maxBackoffMs: 60_000,
};

export function makeTask(overrides = {}) {
  return {
    id: overrides.id ?? "1",
    contract: overrides.contract ?? "payment",
    contractId: overrides.contractId ?? "CBTESTCONTRACT",
    entityId: overrides.entityId ?? "42",
    actionType: overrides.actionType ?? "execute_scheduled_payment",
    subscriptionId: overrides.subscriptionId,
    payload: overrides.payload ?? {},
    nextRunAt: overrides.nextRunAt ?? new Date(0),
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 10,
  };
}

export class FakeLease {
  constructor(address = "GCHANNEL") {
    this.address = address;
    this.secret = `S${address}`;
    this.invalidations = 0;
    this.refetches = 0;
    this.sequence = 0n;
  }

  nextSequence() {
    const current = this.sequence;
    this.sequence += 1n;
    return current;
  }

  invalidate() {
    this.invalidations += 1;
    this.sequence = 0n;
    this.refetches += 1;
  }

  async release() {}
}

export class FakePool {
  constructor(leases = [new FakeLease()]) {
    this.leases = leases;
    this.released = 0;
    this.cursor = 0;
  }

  async acquire() {
    const lease = this.leases[this.cursor % this.leases.length];
    this.cursor += 1;
    return lease;
  }

  async close() {}

  noteRelease() {
    this.released += 1;
  }
}

export class FakeRpc {
  constructor(options = {}) {
    this.simulateImpl = options.simulate;
    this.submitImpl = options.submit;
    this.statusImpl = options.getTransactionStatus;
    this.restoreImpl = options.restoreFootprint;
    this.calls = { simulate: 0, submit: 0, restore: 0, status: 0 };
    this.submitted = [];
  }

  async simulate(transaction) {
    this.calls.simulate += 1;
    if (this.simulateImpl !== undefined) return this.simulateImpl(transaction, this.calls.simulate);
    return { simulation: { ok: true }, gasStroops: 100 };
  }

  assemble(transaction, simulation) {
    return { assembled: true, transaction, simulation };
  }

  async restoreFootprint(lease, preamble) {
    this.calls.restore += 1;
    if (this.restoreImpl !== undefined) await this.restoreImpl(lease, preamble);
  }

  async submit(transaction, gasStroops) {
    this.calls.submit += 1;
    this.submitted.push({ transaction, gasStroops });
    if (this.submitImpl !== undefined) return this.submitImpl(transaction, this.calls.submit, gasStroops);
    return { hash: `tx-${this.calls.submit}`, gasStroops };
  }

  async getTransactionStatus(hash) {
    this.calls.status += 1;
    if (this.statusImpl !== undefined) return this.statusImpl(hash);
    return "SUCCESS";
  }
}

export class FakeFactory {
  constructor() {
    this.built = [];
  }

  build(task, definition, lease) {
    const transaction = {
      functionName: definition.functionName,
      args: definition.args(task),
      sequence: lease.nextSequence(),
    };
    this.built.push(transaction);
    return transaction;
  }
}

export class FakeSigner {
  constructor() {
    this.signed = 0;
  }

  async sign(transaction, task, definition, lease) {
    this.signed += 1;
    return { ...transaction, signedBy: lease.address, taskId: task.id, auth: definition.requiresMerchantAuth };
  }
}

export function makePipeline(options = {}) {
  const rpc = options.rpc ?? new FakeRpc();
  const pool = options.pool ?? new FakePool();
  const factory = options.factory ?? new FakeFactory();
  const signer = options.signer ?? new FakeSigner();
  const pipeline = new SimulateFirstPipeline({
    rpc,
    pool,
    txFactory: factory,
    signer,
    config: options.config ?? TEST_CONFIG,
    sleep: options.sleep ?? (async () => {}),
    now: options.now,
  });
  return { pipeline, rpc, pool, factory, signer };
}
