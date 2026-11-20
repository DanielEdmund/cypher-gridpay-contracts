# Cypher GridPay Crank Worker

Off-chain automation worker for Soroban lifecycle transitions that cannot execute themselves:
scheduled payments, recurring subscriptions, dunning retries, metered billing, trial conversion
notices, merchant payouts, payment expiry, arbitration timeouts and stale-escrow cleanup.

## Design

- `src/scheduler.ts` queries indexed PostgreSQL schedules (`next_run_at <= now + lookahead`)
  and distributes tasks to worker replicas under a `(contract, entity_id, action_type)` lock.
- `src/pipeline.ts` is simulate-first: `simulateTransaction` runs before any signature or
  submission, so already-executed or deterministically reverting tasks never pay gas.
  TTL-expired entries are restored with `restoreFootprint` and re-simulated before submit.
- `src/rpc/stellar.ts` builds Soroban invoke transactions, rotates managed channel accounts,
  refreshes sequence numbers on `tx_bad_seq`, signs with channel/merchant keys and polls the
  resulting transaction hash.
- `src/circuit-breaker.ts` keeps store-backed per-subscription backoff state, so an underfunded
  customer cannot make replicas re-simulate or burn gas on every poll.
- `src/store/postgres.ts` persists schedules, execution outcomes, transaction hashes, gas,
  distributed locks and circuit state; `src/store/memory.ts` is the deterministic test double.
- `src/metrics.ts` exposes Prometheus metrics on `GET /metrics`.

## Setup

```bash
cd services/crank-worker
npm ci
psql "$DATABASE_URL" -f sql/001_crank_schedule.sql
npm run build
npm start
```

The indexer is responsible for populating `crank_schedule`; the worker can also enqueue tasks
programmatically with `ScheduleStore.enqueue({ contract, contractId, entityId, actionType, ... })`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `CRANK_RPC_URL` (or `SOROBAN_RPC_URL`) | Soroban RPC endpoint (`http://localhost:8000/soroban/rpc` for Quickstart) |
| `NETWORK_PASSPHRASE` | Stellar network passphrase |
| `PAYMENT_CONTRACT_ID`, `ESCROW_CONTRACT_ID`, `REFUND_CONTRACT_ID` | Deployed contract addresses |
| `CRANK_CHANNEL_SECRETS` | Comma-separated secrets of sequence-number channel accounts (never log these) |
| `CRANK_MERCHANT_SECRETS` | Optional merchant signing keys for merchant-authorized actions |
| `CRANK_LOOKAHEAD_MS`, `CRANK_BATCH_SIZE`, `CRANK_POLL_INTERVAL_MS`, `CRANK_LOCK_TTL_MS` | Polling/claim tuning |
| `CRANK_BASE_RETRY_MS`, `CRANK_MAX_RETRY_MS` | Transient/dunning retry backoff bounds |
| `CRANK_CIRCUIT_THRESHOLD`, `CRANK_CIRCUIT_BASE_MS`, `CRANK_CIRCUIT_MAX_MS` | Per-subscription circuit breaker |
| `CRANK_METRICS_PORT` | Optional Prometheus HTTP port |
| `CRANK_BASE_FEE_STROOPS`, `CRANK_POLL_ATTEMPTS`, `CRANK_POLL_INITIAL_DELAY_MS`, `CRANK_POLL_MAX_DELAY_MS`, `CRANK_MAX_RESTORE_ATTEMPTS` | Transaction submission tuning |

## Metrics

- `crank_due_queue_depth`
- `crank_execution_latency_seconds` (`action_type`, `status`)
- `crank_gas_spent_stroops_total` (`action_type`)
- `crank_execution_total` (`action_type`, `status`)
- `crank_permanent_failures_total` (`action_type`)
- `crank_skipped_total` (`reason`)

## Tests

```bash
npm test
```

Unit tests cover all nine action mappings, simulate-first gating (zero submissions for
already-executed and deterministic reverts), TTL restore, `tx_bad_seq` recovery, distributed-lock
concurrency with two simultaneous replicas, circuit-breaker backoff, retry-budget exhaustion and
Prometheus exposition.

`test/integration.quickstart.test.mjs` is skipped unless `CRANK_INTEGRATION=1` and the PostgreSQL,
RPC, contract and channel-account variables above are configured. With those set it runs one real
cycle against Quickstart using `npm run test:integration`.
