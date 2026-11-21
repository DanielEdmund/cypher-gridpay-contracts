import assert from "node:assert/strict";
import { test } from "node:test";
import { CrankMetrics } from "../dist/metrics.js";
import { SimulateFirstPipeline } from "../dist/pipeline.js";
import { createStellarStack } from "../dist/rpc/stellar.js";
import { CrankWorker } from "../dist/scheduler.js";
import { PostgresScheduleStore } from "../dist/store/postgres.js";

const enabled =
  process.env.CRANK_INTEGRATION === "1" &&
  process.env.DATABASE_URL !== undefined &&
  process.env.CRANK_RPC_URL !== undefined &&
  process.env.CRANK_CHANNEL_SECRETS !== undefined &&
  process.env.PAYMENT_CONTRACT_ID !== undefined &&
  process.env.ESCROW_CONTRACT_ID !== undefined &&
  process.env.REFUND_CONTRACT_ID !== undefined &&
  process.env.NETWORK_PASSPHRASE !== undefined;

const runIntegration = enabled ? test : test.skip;

runIntegration("worker processes indexed schedules against Quickstart", async () => {
  const pool = new (await import("pg")).Pool({ connectionString: process.env.DATABASE_URL });
  const store = new PostgresScheduleStore(pool);
  await store.initialize();
  const stack = createStellarStack({
    rpcUrl: process.env.CRANK_RPC_URL,
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
    baseFeeStroops: process.env.CRANK_BASE_FEE_STROOPS ?? "10000",
    channelSecrets: process.env.CRANK_CHANNEL_SECRETS.split(/[,;\s]+/).filter(Boolean),
    merchantSecrets: (process.env.CRANK_MERCHANT_SECRETS ?? "").split(/[,;\s]+/).filter(Boolean),
  });
  const metrics = new CrankMetrics();
  const worker = new CrankWorker({
    store,
    metrics,
    owner: `integration-${process.pid}`,
    lookaheadMs: Number(process.env.CRANK_LOOKAHEAD_MS ?? 60_000),
    batchSize: Number(process.env.CRANK_BATCH_SIZE ?? 20),
    lockTtlMs: 120_000,
    pollIntervalMs: 0,
    circuit: {
      failureThreshold: 3,
      baseBackoffMs: 60_000,
      maxBackoffMs: 3_600_000,
    },
    pipeline: new SimulateFirstPipeline({
      rpc: stack.rpcGateway,
      txFactory: stack.txFactory,
      signer: stack.signer,
      pool: stack.pool,
      config: {
        baseRetryMs: 5_000,
        maxRetryMs: 3_600_000,
        pollAttempts: 12,
        pollInitialDelayMs: 500,
        pollMaxDelayMs: 5_000,
        maxRestoreAttempts: 2,
      },
    }),
  });

  const report = await worker.runOnce();
  assert.ok(report.dueDepth >= 0);
  assert.ok(report.processed >= 0);
  assert.equal(report.processed, report.results.length);
  await stack.pool.close();
  await pool.end();
});
