import assert from "node:assert/strict";
import { test } from "node:test";
import { CrankMetrics } from "../dist/metrics.js";

test("Prometheus exposition exposes queue depth, latency, gas and permanent failures", async () => {
  const metrics = new CrankMetrics();
  metrics.setDueQueueDepth(7);
  metrics.observeExecution("execute_scheduled_payment", "executed", 0.25);
  metrics.recordOutcome("execute_scheduled_payment", {
    status: "executed",
    txHash: "tx-1",
    gasStroops: 1_234,
  });
  metrics.recordOutcome("retry_failed_payment", {
    status: "permanent",
    message: "max retries",
    code: 303,
  });

  const text = await metrics.render();
  assert.match(text, /# HELP crank_due_queue_depth/);
  assert.match(text, /crank_due_queue_depth 7/);
  assert.match(text, /crank_execution_latency_seconds_count\{action_type="execute_scheduled_payment",status="executed"\} 1/);
  assert.match(text, /crank_gas_spent_stroops_total\{action_type="execute_scheduled_payment"\} 1234/);
  assert.match(text, /crank_permanent_failures_total\{action_type="retry_failed_payment"\} 1/);
  assert.match(text, /crank_execution_total\{action_type="execute_scheduled_payment",status="executed"\} 1/);
});

test("metrics HTTP server exposes /metrics", async () => {
  const metrics = new CrankMetrics();
  metrics.setDueQueueDepth(1);
  const server = await metrics.startServer(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /crank_due_queue_depth 1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
