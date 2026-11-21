import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlertSink, Logger, SponsorshipLedger, SponsorshipRecord } from "./types.js";

function fields(fields?: Record<string, unknown>): Record<string, unknown> {
  return fields ?? {};
}

export class ConsoleLogger implements Logger {
  constructor(private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {}

  private emit(level: string, message: string, extra?: Record<string, unknown>): void {
    this.sink(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields(extra),
    }));
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.emit("info", message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.emit("warn", message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.emit("error", message, extra);
  }
}

export class JsonlSponsorshipLedger implements SponsorshipLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async record(record: SponsorshipRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export class WebhookAlertSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async alert(message: string, details?: Record<string, unknown>): Promise<void> {
    await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, details: fields(details), timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
  }
}

export class LoggingAlertSink implements AlertSink {
  constructor(private readonly logger: Logger) {}

  alert(message: string, details?: Record<string, unknown>): void {
    this.logger.error("SRE_ALERT", { message, ...fields(details) });
  }
}
