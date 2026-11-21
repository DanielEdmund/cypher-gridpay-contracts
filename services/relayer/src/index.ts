import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryQuotaStore, RedisQuotaStore } from "./quotaStore.js";
import { ChannelPool } from "./channelPool.js";
import { loadConfig } from "./config.js";
import { BadRequestError, RelayerError } from "./errors.js";
import { ConsoleLogger, JsonlSponsorshipLedger, LoggingAlertSink, WebhookAlertSink } from "./observability.js";
import { PolicyEngine } from "./policyEngine.js";
import { RelayerService } from "./relayer.js";
import { HttpSorobanRpc } from "./rpc.js";
import { RemoteKmsSigner } from "./signer.js";
import type { AlertSink, Logger, RelayerConfig, SponsorResult, SponsorshipLedger } from "./types.js";

class PayloadTooLargeError extends RelayerError {
  constructor() {
    super("INVALID_REQUEST", "Request body exceeds the configured size limit", 413);
  }
}

export interface ServerDeps {
  relayer: { sponsor(payload: unknown): Promise<SponsorResult> };
  logger: Logger;
  maxBodyBytes: number;
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += buffer.length;
    if (length > maxBodyBytes) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  if (length === 0) throw new BadRequestError("INVALID_REQUEST", "Request body is empty");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BadRequestError("INVALID_REQUEST", "Request body is not valid JSON");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function createServer(deps: ServerDeps): Server {
  return createHttpServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && path === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (path !== "/v1/relayer/sponsor") {
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Unknown endpoint" } });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" });
      response.end();
      return;
    }
    void (async () => {
      try {
        const payload = await readBody(request, deps.maxBodyBytes);
        const result = await deps.relayer.sponsor(payload);
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof RelayerError) {
          sendJson(response, error.httpStatus, {
            error: { code: error.code, message: error.message, details: error.details },
          });
          return;
        }
        deps.logger.error("unhandled relayer failure", { error: String(error) });
        sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "Internal relayer error" } });
      }
    })();
  });
}

export function buildRelayer(config: RelayerConfig, logger: Logger = new ConsoleLogger()): RelayerService {
  const quotaStore = config.redisUrl
    ? new RedisQuotaStore(
      config.redisUrl,
      { customer: config.customerDailyLimit, merchant: config.merchantDailyLimit },
      config.redisKeyPrefix,
    )
    : new InMemoryQuotaStore(
      { customer: config.customerDailyLimit, merchant: config.merchantDailyLimit },
      config.redisKeyPrefix,
    );
  if (config.redisUrl === undefined) {
    logger.warn("REDIS_URL is not set; daily quotas are process-local and must not be used in production");
  }
  const alerts: AlertSink = config.alertWebhookUrl
    ? new WebhookAlertSink(config.alertWebhookUrl)
    : new LoggingAlertSink(logger);
  const ledger: SponsorshipLedger = new JsonlSponsorshipLedger(config.accountingLogPath);
  const pool = new ChannelPool(config.channels, {
    acquireTimeoutMs: config.acquireTimeoutMs,
    rpc: new HttpSorobanRpc(config.rpcUrl),
    logger,
  });
  const policy = new PolicyEngine({
    config,
    quotaStore,
    rpc: new HttpSorobanRpc(config.rpcUrl),
  });
  return new RelayerService({
    config,
    policy,
    pool,
    rpc: new HttpSorobanRpc(config.rpcUrl),
    signer: new RemoteKmsSigner({
      url: config.kmsSignUrl,
      keys: config.kmsKeys,
      timeoutMs: config.kmsTimeoutMs,
      headers: config.kmsHeaders,
    }),
    ledger,
    alerts,
    logger,
  });
}

export function main(): void {
  const config = loadConfig();
  const logger = new ConsoleLogger();
  const server = createServer({
    relayer: buildRelayer(config, logger),
    logger,
    maxBodyBytes: config.maxBodyBytes,
  });
  server.listen(config.port, () => {
    logger.info("relayer listening", { port: config.port, channels: config.channels.length });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === resolve(fileURLToPath(import.meta.url))) main();

export type { RelayerConfig };
