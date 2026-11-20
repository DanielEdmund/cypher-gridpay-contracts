import assert from "node:assert/strict";
import { test } from "node:test";
import { CrankMetrics } from "../dist/metrics.js";
import { CrankWorker, lockKey } from "../dist/scheduler.js";
import { MemoryScheduleStore } from "../dist/store/memory.js";
import { TEST_CIRCUIT, TEST_CONFIG, FakeRpc, makePipeline, makeTask } from "./helpers.mjs";

function baseWorkerOptions(store, pipeline, metrics, overrides = {}) {
  return {
    store,
    pipeline,
    metrics,
    owner: overrides.owner ?? "worker-test",
    lookaheadMs: 3_600_000,
    batchSize: 50,
    lockTtlMs: 120_000,
    pollIntervalMs: 0,
    circuit: TEST_CIRCUIT,
    now: overrides.now,
    sleep: async () => {},
    logger: () => {},
  };
}

function enqueue(store, overrides) {
  const task = makeTask(overrides);
  return store.enqueue(task);
}

test("due queue includes scheduled payments, subscriptions, trial notices and expiries", async () => {
  const store = new MemoryScheduleStore();
  const metrics = new CrankMetrics();
  const rpc = new FakeRpc();
  const actionTypes = [
    "execute_scheduled_payment",
    "execute_recurring_payment",
    "emit_trial_conversion_notice",
    "expire_payment",
  ];
  for (const [index, actionType] of actionTypes.entries()) {
    await enqueue(store, { id: String(index + 1), entityId: String(index + 1), actionType });
  }
  const { pipeline } = makePipeline({ rpc });
  const worker = new CrankWorker(baseWorkerOptions(store, pipeline, metrics));
  const report = await worker.runOnce();

  assert.equal(report.dueDepth, 4);
  assert.equal(report.processed, 4);
  assert.equal(report.executed, 4);
  assert.equal(rpc.calls.submit, 4);
  for (const task of store.tasks.values()) {
    assert.equal(task.enabled, false);
    assert.match(task.lastTxHash ?? "", /^tx-/);
  }
  const exposition = await metrics.render();
  assert.match(exposition, /crank_due_queue_depth 4/);
  assert.match(exposition, /crank_execution_total\{action_type="execute_recurring_payment",status="executed"\} 1/);
});

test("already executed tasks are skipped with zero submissions and zero gas", async () => {
  const store = new MemoryScheduleStore();
  const metrics = new CrankMetrics();
  const rpc = new FakeRpc({
    simulate: (transaction) => {
      if (transaction.functionName === "execute_scheduled_payment") {
        return { simulation: {}, gasStroops: 0, error: "HostError: Error(Contract, #202)" };
      }
      return { simulation: {}, gasStroops: 50 };
    },
  });
  await enqueue(store, { id: "1", entityId: "1", actionType: "execute_scheduled_payment" });
  await enqueue(store, { id: "2", entityId: "2", actionType: "expire_payment" });
  const { pipeline } = makePipeline({ rpc });
  const worker = new CrankWorker(baseWorkerOptions(store, pipeline, metrics));
  const report = await worker.runOnce();

  assert.equal(report.executed, 1);
  assert.equal(report.skipped, 1);
  assert.equal(rpc.calls.submit, 1);
  assert.equal(store.tasks.get("1").enabled, false);
  assert.equal(store.tasks.get("1").lastTxHash, undefined);
  assert.match(await metrics.render(), /crank_skipped_total\{reason="already_executed"\} 1/);
});

test("two worker replicas never submit duplicate transactions for the same task", async () => {
  const store = new MemoryScheduleStore();
  const metricsA = new CrankMetrics();
  const metricsB = new CrankMetrics();
  const sharedRpc = new FakeRpc();
  const slow = (pipeline) => ({
    async execute(task) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return pipeline.execute(task);
    },
  });

  const actionTypes = [
    "execute_scheduled_payment",
    "execute_recurring_payment",
    "execute_metered_billing",
    "expire_payment",
  ];
  for (const [index, actionType] of actionTypes.entries()) {
    await enqueue(store, { id: String(index + 1), entityId: String(index + 1), actionType });
  }

  const pipelineA = makePipeline({ rpc: sharedRpc }).pipeline;
  const pipelineB = makePipeline({ rpc: sharedRpc }).pipeline;
  const workerA = new CrankWorker(baseWorkerOptions(store, slow(pipelineA), metricsA, { owner: "replica-a" }));
  const workerB = new CrankWorker(baseWorkerOptions(store, slow(pipelineB), metricsB, { owner: "replica-b" }));

  const [reportA, reportB] = await Promise.all([workerA.runOnce(), workerB.runOnce()]);

  assert.equal(sharedRpc.calls.submit, 4);
  assert.ok(reportA.executed + reportB.executed === 4);
  assert.ok(reportA.skipped + reportB.skipped === 4);
  assert.equal([...store.tasks.values()].filter((task) => !task.enabled).length, 4);
  assert.equal(sharedRpc.submitted.length, 4);
});

test("expired distributed lock can be reacquired by another replica", async () => {
  const store = new MemoryScheduleStore();
  const key = lockKey(makeTask());
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(await store.acquireLock(key, "replica-a", t0, 1_000), true);
  assert.equal(await store.acquireLock(key, "replica-b", new Date(t0.getTime() + 500), 1_000), false);
  assert.equal(await store.acquireLock(key, "replica-b", new Date(t0.getTime() + 1_001), 1_000), true);
  await store.releaseLock(key, "replica-b");
  assert.equal(await store.acquireLock(key, "replica-a", new Date(t0.getTime() + 1_002), 1_000), true);
});

test("circuit breaker stops burning simulations for an underfunded subscription", async () => {
  const store = new MemoryScheduleStore();
  let current = new Date("2026-01-01T00:00:00.000Z");
  const rpc = new FakeRpc({
    simulate: () => ({
      simulation: {},
      gasStroops: 0,
      error: "HostError: Error(Contract, #303) insufficient balance",
    }),
  });
  await enqueue(store, {
    id: "1",
    entityId: "555",
    actionType: "retry_failed_payment",
    subscriptionId: "99",
  });
  const { pipeline } = makePipeline({ rpc, now: () => current });
  const worker = new CrankWorker(
    baseWorkerOptions(store, pipeline, new CrankMetrics(), { now: () => current }),
  );

  await worker.runOnce();
  current = new Date(current.getTime() + 10_000);
  await worker.runOnce();
  current = new Date(current.getTime() + 10_000);
  const third = await worker.runOnce();
  assert.equal(third.results[0].outcome.status, "failed");
  const circuit = await store.getCircuit("99");
  assert.equal(circuit.state, "open");
  assert.equal(circuit.failures, 3);
  const simulationsBefore = rpc.calls.simulate;

  current = new Date(current.getTime() + 1_000);
  const fourth = await worker.runOnce();
  assert.equal(fourth.results[0].outcome.status, "skipped");
  assert.equal(fourth.results[0].outcome.reason, "circuit_open");
  assert.equal(rpc.calls.simulate, simulationsBefore);
  assert.equal(rpc.calls.submit, 0);
});

test("a permanently failing job is closed out after its retry budget", async () => {
  const store = new MemoryScheduleStore();
  let current = new Date("2026-01-01T00:00:00.000Z");
  const rpc = new FakeRpc({
    simulate: () => ({ simulation: {}, gasStroops: 0, error: "HostError: Error(Contract, #303)" }),
  });
  await enqueue(store, { id: "1", entityId: "1", actionType: "execute_recurring_payment", maxAttempts: 2 });
  const { pipeline } = makePipeline({ rpc, now: () => current });
  const worker = new CrankWorker(
    baseWorkerOptions(store, pipeline, new CrankMetrics(), { now: () => current }),
  );
  const first = await worker.runOnce();
  assert.equal(first.results[0].outcome.status, "failed");
  current = new Date(current.getTime() + 10_000);
  const second = await worker.runOnce();
  assert.equal(second.results[0].outcome.status, "permanent");
  assert.equal(store.tasks.get("1").enabled, false);
  assert.equal(rpc.calls.submit, 0);
});
