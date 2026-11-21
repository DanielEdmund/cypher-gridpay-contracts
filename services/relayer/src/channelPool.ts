import { ChannelUnavailableError, InternalError } from "./errors.js";
import type { ChannelLease, ChannelState, Logger, SorobanRpc } from "./types.js";

interface ManagedChannel extends ChannelState {
  busy: boolean;
}

interface PoolOptions {
  acquireTimeoutMs?: number;
  rpc?: SorobanRpc;
  logger?: Logger;
}

class PooledChannelLease implements ChannelLease {
  private done = false;

  constructor(
    private readonly pool: ChannelPool,
    private readonly channel: ManagedChannel,
    readonly accountId: string,
  ) {}

  get sequence(): string {
    return this.channel.sequence;
  }

  get settled(): boolean {
    return this.done;
  }

  succeed(): void {
    if (this.done) return;
    this.done = true;
    this.channel.sequence = (BigInt(this.channel.sequence) + 1n).toString();
    this.pool.release(this.channel);
  }

  fail(reason: string): void {
    if (this.done) return;
    this.done = true;
    void this.pool.refresh(this.channel.accountId, reason).catch(() => undefined);
    this.pool.release(this.channel);
  }
}

export class ChannelPool {
  private readonly channels: ManagedChannel[];
  private readonly waiters: Array<(lease: ChannelLease) => void> = [];
  private cursor = 0;

  constructor(states: ChannelState[], private readonly options: PoolOptions = {}) {
    if (states.length === 0) throw new InternalError("ChannelPool requires at least one channel");
    const seen = new Set<string>();
    for (const state of states) {
      if (seen.has(state.accountId)) {
        throw new InternalError(`Duplicate channel account: ${state.accountId}`);
      }
      seen.add(state.accountId);
      if (!/^\d+$/.test(state.sequence)) {
        throw new InternalError(`Invalid sequence for channel ${state.accountId}`);
      }
    }
    this.channels = states.map((state) => ({ ...state, busy: false }));
  }

  get size(): number {
    return this.channels.length;
  }

  available(): number {
    return this.channels.filter((channel) => !channel.busy).length;
  }

  sequenceOf(accountId: string): string | undefined {
    return this.channels.find((channel) => channel.accountId === accountId)?.sequence;
  }

  async acquire(): Promise<ChannelLease> {
    for (let offset = 0; offset < this.channels.length; offset += 1) {
      const index = (this.cursor + offset) % this.channels.length;
      const channel = this.channels[index];
      if (channel === undefined || channel.busy) continue;
      this.cursor = (index + 1) % this.channels.length;
      channel.busy = true;
      return new PooledChannelLease(this, channel, channel.accountId);
    }
    const timeoutMs = this.options.acquireTimeoutMs ?? 10_000;
    return new Promise<ChannelLease>((resolve, reject) => {
      const waiter = (lease: ChannelLease): void => {
        clearTimeout(timer);
        resolve(lease);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new ChannelUnavailableError(`Timed out waiting for a fee-source channel after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  setSequence(accountId: string, sequence: string): void {
    const channel = this.channels.find((entry) => entry.accountId === accountId);
    if (channel === undefined) throw new InternalError(`Unknown channel account: ${accountId}`);
    if (!/^\d+$/.test(sequence)) throw new InternalError(`Invalid sequence: ${sequence}`);
    channel.sequence = sequence;
  }

  async refresh(accountId: string, reason?: string): Promise<void> {
    const channel = this.channels.find((entry) => entry.accountId === accountId);
    if (channel === undefined || this.options.rpc === undefined) return;
    const state = await this.options.rpc.getAccount(accountId);
    channel.sequence = state.sequence;
    this.options.logger?.warn("channel sequence refreshed", {
      accountId,
      sequence: state.sequence,
      reason,
    });
  }

  release(channel: ManagedChannel): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) {
      channel.busy = false;
      return;
    }
    waiter(new PooledChannelLease(this, channel, channel.accountId));
  }
}
