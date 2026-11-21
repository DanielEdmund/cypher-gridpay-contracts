import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError, classifyErrorCode, extractErrorCode } from "../dist/errors.js";
import {
  FakeFactory,
  FakeLease,
  FakePool,
  FakeRpc,
  FakeSigner,
  TEST_CONFIG,
  makePipeline,
  makeTask,
} from "./helpers.mjs";

const now = new Date("2026-01-01T00:00:00.000Z");

test("simulation result #202 skips submission with zero gas", async () => {
  const rpc = new FakeRpc({
    simulate: () => ({ simulation: {}, gasStroops: 0, error: "HostError: Error(Contract, #202)" }),
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "already_executed");
  assert.equal(rpc.calls.submit, 0);
});

test("not-due simulation reschedules instead of disabling the task", async () => {
  const rpc = new FakeRpc({
    simulate: () => ({ simulation: {}, gasStroops: 0, error: "HostError: Error(Contract, #208)" }),
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "not_due");
  assert.equal(outcome.nextRetryAt.getTime(), now.getTime() + TEST_CONFIG.baseRetryMs);
  assert.equal(rpc.calls.submit, 0);
});

test("deterministic insufficient-balance revert triggers dunning backoff without a submit", async () => {
  const rpc = new FakeRpc({
    simulate: () => ({ simulation: {}, gasStroops: 0, error: "HostError: insufficient balance for customer charge" }),
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask({ actionType: "retry_failed_payment", subscriptionId: "7" }));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.kind, "deterministic");
  assert.equal(rpc.calls.submit, 0);
  assert.equal(outcome.retryAt.getTime(), now.getTime() + TEST_CONFIG.baseRetryMs);
});

test("transient RPC failure is retried later and never spends gas", async () => {
  const rpc = new FakeRpc({
    simulate: () => {
      throw new Error("network timeout connecting to RPC");
    },
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.kind, "transient");
  assert.equal(rpc.calls.submit, 0);
});

test("TTL restore runs before re-simulation and submission", async () => {
  const lease = new FakeLease();
  const pool = new FakePool([lease]);
  const factory = new FakeFactory();
  const rpc = new FakeRpc({
    simulate: (_transaction, call) =>
      call === 1
        ? {
            simulation: {},
            gasStroops: 0,
            restorePreamble: { minResourceFee: "10", transactionData: {} },
          }
        : { simulation: {}, gasStroops: 250 },
  });
  const { pipeline } = makePipeline({ rpc, pool, factory, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "executed");
  assert.equal(rpc.calls.restore, 1);
  assert.equal(rpc.calls.simulate, 2);
  assert.equal(rpc.calls.submit, 1);
  assert.equal(factory.built.length, 2);
  assert.equal(factory.built[0].sequence, 0n);
  assert.equal(factory.built[1].sequence, 1n);
  assert.equal(outcome.gasStroops, 250);
});

test("tx_bad_seq invalidates the channel lease and rebuilds the transaction", async () => {
  const lease = new FakeLease();
  const pool = new FakePool([lease]);
  const factory = new FakeFactory();
  const rpc = new FakeRpc({
    submit: (_transaction, call, gas) => {
      if (call === 1) throw new Error("tx_bad_seq from RPC");
      return { hash: `tx-${call}`, gasStroops: gas };
    },
  });
  const { pipeline } = makePipeline({ rpc, pool, factory, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "executed");
  assert.equal(lease.refetches, 1);
  assert.equal(rpc.calls.submit, 2);
  assert.equal(rpc.calls.simulate, 2);
  assert.equal(factory.built.length, 2);
});

test("on-ledger failure records the tx hash and paid gas", async () => {
  const rpc = new FakeRpc({
    getTransactionStatus: () => "FAILED",
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.kind, "deterministic");
  assert.equal(outcome.txHash, "tx-1");
  assert.equal(outcome.gasStroops, 100);
});

test("pending transaction is treated as transient so the next simulation can detect execution", async () => {
  const rpc = new FakeRpc({
    getTransactionStatus: () => "PENDING",
  });
  const { pipeline } = makePipeline({ rpc, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.kind, "transient");
  assert.equal(outcome.txHash, "tx-1");
});

test("all nine permissionless actions map to the expected contract calls", async () => {
  const cases = [
    ["execute_scheduled_payment", "payment", "execute_scheduled_payment", 0],
    ["execute_recurring_payment", "payment", "execute_recurring_payment", 0],
    ["execute_metered_billing", "payment", "execute_metered_billing", 0],
    ["retry_failed_payment", "payment", "retry_failed_payment", 0],
    ["emit_trial_conversion_notice", "payment", "emit_trial_conversion_notice", 0],
    ["trigger_scheduled_payout", "payment", "trigger_scheduled_payout", 0],
    ["expire_payment", "payment", "expire_payment", 0],
    ["trigger_arbitration_timeout", "refund", "trigger_arbitration_timeout", 0],
    ["cleanup_stale_escrow", "escrow", "settle_dormant_escrow", 1],
  ];
  for (const [actionType, contract, functionName, argCount] of cases) {
    const factory = new FakeFactory();
    const rpc = new FakeRpc();
    const task = makeTask({
      actionType,
      contract,
      subscriptionId: "99",
      payload: { merchant: "GPAYER" },
    });
    const { pipeline } = makePipeline({ rpc, factory, now: () => now });
    const outcome = await pipeline.execute(task);
    assert.equal(outcome.status, "executed", actionType);
    assert.equal(factory.built[0].functionName, functionName);
    assert.ok(factory.built[0].args.length >= argCount);
  }
});

test("error classifier recognizes already-executed, not-due and deterministic codes", () => {
  assert.equal(extractErrorCode("Error(Contract, #202)"), 202);
  assert.equal(classifyErrorCode(202, ""), "already_executed");
  assert.equal(classifyErrorCode(309, ""), "not_due");
  assert.equal(classifyErrorCode(303, ""), "deterministic");
  assert.equal(classifyError(new Error("HostError: Error(Contract, #208)")).kind, "not_due");
  assert.equal(classifyError(new Error("fetch failed")).kind, "transient");
});

test("lease is released even when the pipeline fails", async () => {
  let releases = 0;
  const lease = new FakeLease();
  lease.release = async () => {
    releases += 1;
  };
  const pool = new FakePool([lease]);
  const rpc = new FakeRpc({
    simulate: () => {
      throw new Error("connection reset");
    },
  });
  const { pipeline } = makePipeline({ rpc, pool, now: () => now });
  const outcome = await pipeline.execute(makeTask());
  assert.equal(outcome.status, "failed");
  assert.equal(releases, 1);
});
