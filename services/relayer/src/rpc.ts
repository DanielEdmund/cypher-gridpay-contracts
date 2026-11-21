import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-sdk";
import { InternalError } from "./errors.js";
import type {
  AccountState,
  SimulatedTransaction,
  SorobanRpc,
  SubmitResult,
  TransactionResult,
} from "./types.js";

interface RpcEnvelope<T> {
  jsonrpc?: string;
  id?: number;
  result?: T;
  error?: { code?: number; message?: string };
}

interface SimulateRpcResult {
  error?: string;
  results?: Array<{ error?: string; returnValue?: unknown }>;
  restorePreamble?: unknown;
  latestLedger?: number;
}

interface AccountRpcResult {
  accountId?: string;
  sequence?: string;
  balances?: Array<{ asset?: string; amount?: string }>;
}

export function stroopsFromAmount(amount: string): number {
  const value = amount.trim();
  const [whole = "0", fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new InternalError(`Invalid native balance amount: ${amount}`);
  }
  const padded = `${fraction}0000000`.slice(0, 7);
  return Number(BigInt(whole) * 10_000_000n + BigInt(padded));
}

export class HttpSorobanRpc implements SorobanRpc {
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new InternalError(`Soroban RPC ${method} transport failure: ${String(error)}`);
    }
    if (!response.ok) {
      throw new InternalError(`Soroban RPC ${method} returned HTTP ${response.status}`);
    }
    let envelope: RpcEnvelope<T>;
    try {
      envelope = (await response.json()) as RpcEnvelope<T>;
    } catch (error) {
      throw new InternalError(`Soroban RPC ${method} returned invalid JSON: ${String(error)}`);
    }
    if (envelope.error !== undefined) {
      throw new InternalError(`Soroban RPC ${method} error: ${envelope.error.message ?? "unknown"}`, {
        code: envelope.error.code,
      });
    }
    if (envelope.result === undefined) {
      throw new InternalError(`Soroban RPC ${method} returned no result`);
    }
    return envelope.result;
  }

  async simulateTransaction(transaction: Transaction): Promise<SimulatedTransaction> {
    const result = await this.call<SimulateRpcResult>("simulateTransaction", [transaction.toXDR()]);
    return {
      error: result.error,
      results: result.results ?? [],
      restoreRequired: result.restorePreamble !== undefined && result.restorePreamble !== null,
      latestLedger: result.latestLedger,
    };
  }

  async sendTransaction(transaction: FeeBumpTransaction): Promise<SubmitResult> {
    return this.call<SubmitResult>("sendTransaction", [transaction.toXDR()]);
  }

  async getTransaction(hash: string): Promise<TransactionResult> {
    return this.call<TransactionResult>("getTransaction", [hash]);
  }

  async getAccount(accountId: string): Promise<AccountState> {
    const result = await this.call<AccountRpcResult>("getAccount", [accountId]);
    if (result.sequence === undefined) {
      throw new InternalError(`Soroban RPC getAccount returned no sequence for ${accountId}`);
    }
    const native = result.balances?.find((balance) => balance.asset === "native");
    return {
      accountId: result.accountId ?? accountId,
      sequence: result.sequence,
      nativeBalanceStroops: native?.amount === undefined ? 0 : stroopsFromAmount(native.amount),
    };
  }
}
