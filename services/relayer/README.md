# Cypher GridPay Gasless Relayer

A production-oriented fee-bump relayer for GridPay customers who hold USDC but no XLM. It accepts a customer-signed Soroban transaction, applies a strict policy engine, simulates it against Soroban RPC, checks daily quotas, wraps it in a Stellar fee-bump transaction signed by a KMS-held fee-source key, submits it, tracks confirmation and records the exact stroop spend for merchant rebate / relayer stipend accounting.

## API

- `GET /healthz` → `{ "status": "ok" }`
- `POST /v1/relayer/sponsor`

Request:

```json
{
  "transactionXdr": "<base64 TransactionEnvelope>",
  "customerId": "G...",
  "merchantId": "merchant-42"
}
```

`customerId` is optional and defaults to the inner transaction source account. `merchantId` is optional but enables the per-merchant daily quota and merchant attribution in the accounting log.

Successful response:

```json
{
  "hash": "<fee-bump tx hash>",
  "innerHash": "<inner tx hash>",
  "feeStroops": 200,
  "innerFeeStroops": 100,
  "incrementalStroops": 100,
  "channelAccount": "G...",
  "contractIds": ["<64 hex chars>"],
  "entrypoints": ["create_payment"]
}
```

Errors are JSON: `{ "error": { "code": "...", "message": "...", "details": {} } }`. Policy violations return 403, safety halts and channel exhaustion 503, submission problems 502, confirmation problems 504, malformed input 400/413.

## Policy engine

Every operation in the inner transaction must be an `InvokeHostFunction` that calls a whitelisted contract ID and an approved entrypoint. `Payment`, `ChangeTrust`, `SetOptions`, `AccountMerge` and all other operation types are rejected before any simulation or signing. Nested fee-bump envelopes are rejected as inner transactions.

Before sponsorship the service:

1. Parses the inner XDR and inspects every operation, target contract and function name.
2. Rejects `fee > MAX_SPONSORED_STROOPS` and any fee-bump total above the same cap.
3. Simulates the inner transaction via `simulateTransaction`; reverting results, simulation errors and archived-entry restore requirements are rejected.
4. Atomically reserves per-customer and per-merchant daily quotas in Redis (UTC-day keys, `INCR` + `EXPIREAT` in one Lua script). Reservations are released on any later failure.
5. Checks the fee-source account native balance against `RELAYER_SAFETY_FLOOR_STROOPS`; a low balance halts sponsorship and sends an SRE alert.

## Channel pool and sequence safety

Fee-source accounts are leased exclusively from `ChannelPool` (round-robin with a FIFO wait queue and bounded acquire timeout), so concurrent sponsorships never reuse the same fee-source key. Local sequence state is advanced after success and refreshed from RPC after a failure; `tx_bad_seq` triggers one refresh-and-retry. The concurrency test submits 25 simultaneous sponsorships through 5 channels and asserts there are no channel collisions.

## Signing and accounting

Private keys never enter the service. `RemoteKmsSigner` sends the fee-bump transaction hash to an internal signing endpoint with the KMS key ID mapped to the leasing fee-source account; the returned 64-byte Ed25519 signature is attached to the envelope. Each confirmed sponsorship is appended as JSONL to `RELAYER_ACCOUNTING_LOG` with customer, merchant, contract IDs, entrypoints, channel account, inner fee, total fee and incremental stroop spend.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `8080` | HTTP listen port |
| `STELLAR_RPC_URL` | yes | — | Soroban RPC endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | yes | — | Network passphrase used for XDR parsing/signing |
| `RELAYER_CONTRACT_IDS` | yes | — | Comma-separated whitelisted contract IDs (`C...` or 64-hex) |
| `RELAYER_APPROVED_ENTRYPOINTS` | no | GridPay entrypoints | Comma-separated allowlist of function names |
| `MAX_SPONSORED_STROOPS` | no | `200000` | Per-transaction sponsorship fee cap |
| `RELAYER_FEE_BUMP_BASE_FEE_STROOPS` | no | `100` | Base fee passed to `buildFeeBumpTransaction` |
| `RELAYER_SAFETY_FLOOR_STROOPS` | no | `10000000` | Halt threshold for fee-source XLM balance |
| `RELAYER_CUSTOMER_DAILY_LIMIT` | no | `10` | Daily sponsorships per customer (0 disables) |
| `RELAYER_MERCHANT_DAILY_LIMIT` | no | `1000` | Daily sponsorships per merchant (0 disables) |
| `RELAYER_CHANNEL_ACCOUNTS` | yes | — | Comma-separated `G...` fee-source accounts |
| `RELAYER_KMS_SIGN_URL` | yes | — | Internal KMS signing endpoint |
| `RELAYER_KMS_KEYS` | yes | — | JSON map `{ "G...": "kms-key-id" }` for every channel |
| `RELAYER_KMS_HEADERS` | no | `{}` | JSON map of extra signing headers |
| `RELAYER_KMS_TIMEOUT_MS` | no | `5000` | Signing timeout |
| `REDIS_URL` | production | — | Redis for daily quotas; without it quotas are process-local only |
| `RELAYER_REDIS_PREFIX` | no | `relayer:quota` | Redis key prefix |
| `RELAYER_CONFIRMATION_TIMEOUT_MS` | no | `30000` | Confirmation polling deadline |
| `RELAYER_POLL_INTERVAL_MS` | no | `500` | Confirmation polling interval |
| `RELAYER_ACQUIRE_TIMEOUT_MS` | no | `10000` | Channel lease wait timeout |
| `RELAYER_ACCOUNTING_LOG` | no | `sponsorships.jsonl` | JSONL accounting log path |
| `RELAYER_ALERT_WEBHOOK_URL` | no | stdout | SRE alert webhook |
| `RELAYER_MAX_BODY_BYTES` | no | `1048576` | HTTP body limit |
| `RELAYER_MAX_XDR_CHARS` | no | `262144` | Inner XDR length limit |

## Run and verify

```bash
cd services/relayer
npm ci
npm run typecheck
npm test
npm run build
node dist/index.js
```

The test suite uses in-memory quotas, a fake Soroban RPC and local test keypairs, so it needs no network, Redis, KMS or running Quickstart instance. For a manual Quickstart acceptance run, deploy the payment contract, set `RELAYER_CONTRACT_IDS` to its ID, point `STELLAR_RPC_URL` at Quickstart, configure KMS and channel accounts, then POST a zero-XLM customer's `create_payment` XDR to `/v1/relayer/sponsor`.
