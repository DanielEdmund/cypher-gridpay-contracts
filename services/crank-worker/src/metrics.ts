import { createServer, type Server } from "node:http";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { ExecutionOutcome } from "./types.js";

export class CrankMetrics {
  readonly registry = new Registry();

  private readonly dueDepth = new Gauge({
    name: "crank_due_queue_depth",
    help: "Number of enabled crank tasks whose next_run_at is within the lookahead window",
    registers: [this.registry],
  });

  private readonly latency = new Histogram({
    name: "crank_execution_latency_seconds",
    help: "Time spent simulating and submitting a crank task",
    labelNames: ["action_type", "status"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly gas = new Counter({
    name: "crank_gas_spent_stroops_total",
    help: "Resource fees paid for submitted crank transactions, in stroops",
    labelNames: ["action_type"] as const,
    registers: [this.registry],
  });

  private readonly executions = new Counter({
    name: "crank_execution_total",
    help: "Crank task outcomes by action type and status",
    labelNames: ["action_type", "status"] as const,
    registers: [this.registry],
  });

  private readonly permanent = new Counter({
    name: "crank_permanent_failures_total",
    help: "Crank jobs that exhausted their retry budget or reverted deterministically",
    labelNames: ["action_type"] as const,
    registers: [this.registry],
  });

  private readonly skips = new Counter({
    name: "crank_skipped_total",
    help: "Tasks skipped without submitting a transaction",
    labelNames: ["reason"] as const,
    registers: [this.registry],
  });

  setDueQueueDepth(depth: number): void {
    this.dueDepth.set(depth);
  }

  observeExecution(actionType: string, status: string, seconds: number): void {
    this.latency.labels(actionType, status).observe(seconds);
  }

  recordGas(actionType: string, gasStroops: number): void {
    if (gasStroops > 0) this.gas.labels(actionType).inc(gasStroops);
  }

  recordOutcome(actionType: string, outcome: ExecutionOutcome): void {
    const status = outcome.status === "failed" ? `failed_${outcome.kind}` : outcome.status;
    this.executions.labels(actionType, status).inc();
    if (outcome.status === "skipped") this.skips.labels(outcome.reason).inc();
    if (outcome.status === "permanent") this.permanent.labels(actionType).inc();
    if (outcome.status === "executed" || outcome.status === "failed" || outcome.status === "permanent") {
      this.recordGas(actionType, outcome.gasStroops ?? 0);
    }
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  async startServer(port: number): Promise<Server> {
    const server = createServer(async (request, response) => {
      if (request.url === "/metrics") {
        response.writeHead(200, { "Content-Type": this.registry.contentType });
        response.end(await this.render());
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, resolve);
    });
    return server;
  }
}
