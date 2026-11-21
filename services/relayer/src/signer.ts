import type { FeeBumpTransaction } from "@stellar/stellar-sdk";
import { InternalError } from "./errors.js";
import type { SponsorSigner } from "./types.js";

export interface KmsSignerOptions {
  url: string;
  keys: Record<string, string>;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface KmsResponse {
  signature?: string;
  signatureEncoding?: string;
  error?: string;
}

export class RemoteKmsSigner implements SponsorSigner {
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: KmsSignerOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.headers = { "content-type": "application/json", ...(options.headers ?? {}) };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sign(transaction: FeeBumpTransaction): Promise<FeeBumpTransaction> {
    const keyId = this.options.keys[transaction.feeSource];
    if (keyId === undefined) {
      throw new InternalError(`No KMS key configured for fee source ${transaction.feeSource}`);
    }
    const digest = transaction.hash();
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          keyId,
          payload: digest.toString("base64"),
          encoding: "base64",
          algorithm: "ed25519",
          publicKey: transaction.feeSource,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new InternalError(`KMS signing transport failure: ${String(error)}`);
    }
    if (!response.ok) {
      throw new InternalError(`KMS signing returned HTTP ${response.status}`);
    }
    let body: KmsResponse;
    try {
      body = (await response.json()) as KmsResponse;
    } catch (error) {
      throw new InternalError(`KMS signing returned invalid JSON: ${String(error)}`);
    }
    if (body.error !== undefined || typeof body.signature !== "string") {
      throw new InternalError(`KMS signing failed: ${body.error ?? "missing signature"}`);
    }
    const signature = body.signatureEncoding === "hex"
      ? Buffer.from(body.signature, "hex")
      : Buffer.from(body.signature, "base64");
    if (signature.length !== 64) {
      throw new InternalError(`KMS returned an invalid signature length: ${signature.length}`);
    }
    transaction.addSignature(transaction.feeSource, signature.toString("base64"));
    return transaction;
  }
}
