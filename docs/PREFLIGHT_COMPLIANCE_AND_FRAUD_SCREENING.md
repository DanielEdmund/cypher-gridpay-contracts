# Pre-Flight Compliance, Fraud Scoring & Soroban RPC Proxy Architecture

This document specifies the pre-flight risk mitigation layer, multi-provider RPC infrastructure, and multisig proposal coordination services for Cypher GridPay.

---

## 1. Pre-Flight Fraud Scoring & Compliance Screening

Before issuing a hosted checkout session or sponsoring gas fees via the fee-bump relayer, the Pre-Flight Risk Engine runs synchronous checks:

| Risk Check | Implementation / Heuristics | Action on Violation |
|---|---|---|
| **Sanctions Screening** | Real-time screening against OFAC, EU, and UN sanctions lists via Chainalysis / TRM Labs API | Reject checkout with `SANCTIONED_ADDRESS_FORBIDDEN` |
| **Velocity Anomaly Detection** | Sliding window rate limiter: max 5 transactions per minute per card/wallet fingerprint | Trigger CAPTCHA / temporary cooldown |
| **Duplicate Payment Fingerprinting** | Hashing `(customer, merchant, amount, cart_digest)` within a 10-minute window | Reject duplicate payment submission |
| **Refund-Ring Heuristics** | Graph detection of circular refund loops between colluding merchants and buyer wallets | Flag for manual arbitrator review & freeze funds |

---

## 2. Resilient Multi-Provider Soroban RPC Load Balancer & Proxy

All off-chain GridPay backend services depend on continuous Soroban RPC availability:
- **Round-Robin Pool**: Balances load across official Stellar, Blockdaemon, and NowNodes RPC endpoints.
- **Circuit Breaker**: Detects provider latency spikes (> 2500ms) or 5xx error bursts (> 5% in 30s) and automatically trips the circuit to direct traffic to healthy backends.
- **Read-Through Cache**: Ephemeral ledger state and contract instance code are cached in Redis to minimize RPC billing overhead.

---

## 3. Multi-Sig Proposal Coordination & XDR Diff Inspector

For protocol administration in `orchestrator/contracts/admin`:
- **XDR Diff Inspector**: Decompiles proposed Soroban transaction XDR and outputs human-readable field diffs (e.g. changing fee allocations or upgrading WASM bytecode).
- **Cosigner Dispatch**: Dispatches automated Slack, Telegram, and email alerts to designated multisig cosigners when a proposal is queued.

---

## 4. Automated Backend Integration & Contract-Event Replay Suite

- Standalone test harness using Docker Compose (`docker-compose.test.yml`) spinning up ephemeral PostgreSQL, Redis, and Stellar Quickstart standalone node.
- Replays contract event logs to verify that off-chain read-model projections match onchain balances 1:1.
