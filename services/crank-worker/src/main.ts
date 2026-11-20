import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { CrankMetrics } from "./metrics.js";
import { SimulateFirstPipeline } from "./pipeline.js";
import { createStellarStack } from "./rpc/stellar.js";
import { CrankWorker } from "./scheduler.js";
import { PostgresScheduleStore } from "./store/postgres.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pgPool = new Pool({ connectionString: config.databaseUrl });
  const store = new PostgresScheduleStore(pgPool);
  await store.initialize();

  const stack = createStellarStack(config);
  const metrics = new CrankMetrics();
  const metricsServer = config.metricsPort === undefined ? undefined : await metrics.startServer(config.metricsPort);

  const pipeline = new SimulateFirstPipeline({
    rpc: stack.rpcGateway,
    txFactory: stack.txFactory,
    signer: stack.signer,
    pool: stack.pool,
    config,
  });
  const worker = new CrankWorker({
    store,
    pipeline,
    metrics,
    owner: `${process.env.CRANK_WORKER_ID ?? ""}:${process.pid}`.replace(/^:/, ""),
    lookaheadMs: config.lookaheadMs,
    batchSize: config.batchSize,
    lockTtlMs: config.lockTtlMs,
    pollIntervalMs: config.pollIntervalMs,
    circuit: {
      failureThreshold: config.failureThreshold,
      baseBackoffMs: config.baseBackoffMs,
      maxBackoffMs: config.maxBackoffMs,
    },
    logger: (message) => console.log(message),
  });

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  await worker.runForever(controller.signal);

  metricsServer?.close();
  await stack.pool.close();
  await pgPool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
