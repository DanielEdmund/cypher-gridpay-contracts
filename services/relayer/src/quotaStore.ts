import { Redis } from "ioredis";
import { PolicyViolationError } from "./errors.js";
import type { QuotaReservation, QuotaScope, QuotaStore } from "./types.js";

interface CounterEntry {
  value: number;
  expiresAt: number;
}

const RESERVE_SCRIPT = `
local current = redis.call("INCRBY", KEYS[1], ARGV[1])
if current == ARGV[1] then redis.call("EXPIREAT", KEYS[1], ARGV[2]) end
local limit = tonumber(ARGV[3])
if current > limit then
  redis.call("DECRBY", KEYS[1], ARGV[1])
  return current
end
return 0
`;

const RELEASE_SCRIPT = `
local current = redis.call("DECRBY", KEYS[1], ARGV[1])
if current < 0 then redis.call("SET", KEYS[1], 0) end
return current
`;

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function nextUtcMidnight(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function quotaKey(prefix: string, scope: QuotaScope, id: string, nowMs: number): string {
  return `${prefix}:${scope}:${id}:${utcDayKey(nowMs)}`;
}

class CountdownReservation implements QuotaReservation {
  private finished = false;

  constructor(private readonly releaseFn: () => Promise<void>) {}

  async consume(): Promise<void> {
    this.finished = true;
  }

  async release(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await this.releaseFn();
  }
}

export class InMemoryQuotaStore implements QuotaStore {
  private readonly counters = new Map<string, CounterEntry>();

  constructor(
    private readonly limits: Partial<Record<QuotaScope, number>> = {},
    private readonly prefix = "relayer:quota",
  ) {}

  private limitFor(scope: QuotaScope): number {
    return this.limits[scope] ?? Number.MAX_SAFE_INTEGER;
  }

  private purge(nowMs: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt <= nowMs) this.counters.delete(key);
    }
  }

  usage(scope: QuotaScope, id: string, nowMs = Date.now()): number {
    this.purge(nowMs);
    return this.counters.get(quotaKey(this.prefix, scope, id, nowMs))?.value ?? 0;
  }

  async reserve(scope: QuotaScope, id: string, amount: number, nowMs = Date.now()): Promise<QuotaReservation> {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Quota amount must be a positive integer");
    }
    this.purge(nowMs);
    const key = quotaKey(this.prefix, scope, id, nowMs);
    const entry = this.counters.get(key) ?? { value: 0, expiresAt: nextUtcMidnight(nowMs) };
    const next = entry.value + amount;
    const limit = this.limitFor(scope);
    if (next > limit) {
      throw new PolicyViolationError("QUOTA_EXCEEDED", `Daily ${scope} sponsorship quota exceeded`, {
        scope,
        id,
        limit,
      });
    }
    entry.value = next;
    this.counters.set(key, entry);
    return new CountdownReservation(async () => {
      const current = this.counters.get(key);
      if (current === undefined) return;
      current.value = Math.max(0, current.value - amount);
    });
  }
}

export class RedisQuotaStore implements QuotaStore {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly limits: Partial<Record<QuotaScope, number>>,
    private readonly prefix = "relayer:quota",
    client?: Redis,
  ) {
    this.redis = client ?? new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
  }

  private limitFor(scope: QuotaScope): number {
    return this.limits[scope] ?? Number.MAX_SAFE_INTEGER;
  }

  async reserve(scope: QuotaScope, id: string, amount: number, nowMs = Date.now()): Promise<QuotaReservation> {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Quota amount must be a positive integer");
    }
    const key = quotaKey(this.prefix, scope, id, nowMs);
    const exceeded = await this.redis.eval(
      RESERVE_SCRIPT,
      1,
      key,
      String(Math.floor(nextUtcMidnight(nowMs) / 1000)),
      String(this.limitFor(scope)),
      String(amount),
    );
    if (Number(exceeded) !== 0) {
      throw new PolicyViolationError("QUOTA_EXCEEDED", `Daily ${scope} sponsorship quota exceeded`, {
        scope,
        id,
        limit: this.limitFor(scope),
      });
    }
    return new CountdownReservation(async () => {
      await this.redis.eval(RELEASE_SCRIPT, 1, key, String(amount));
    });
  }

  async quit(): Promise<void> {
    await this.redis.quit();
  }
}
