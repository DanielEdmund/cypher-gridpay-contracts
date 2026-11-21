# Cypher GridPay Resumable Event Indexer & Read-Model Architecture

This document specifies the foundational off-chain data plane for Cypher GridPay:
1. Resumable Soroban Contract Event Indexer with Cursor Checkpointing (Issue #447)
2. Merchant & Customer Read-Model REST API with Redis Caching (Issue #449)
3. Reliable Webhook Delivery Engine with HMAC-SHA256 Signing (Issue #448)
4. SEP-10 / SEP-53 Wallet Authentication & RBAC (Issue #450)

---

## 1. Resumable Soroban Contract Event Indexer

The Event Indexer ingests events from `Payment`, `Escrow`, `Refund`, and `Admin` contracts:
- **Ledger Cursor Checkpointing**: Maintains a persistent checkpoint in PostgreSQL (`indexer_cursor(contract_id, last_ledger, last_paging_token)`).
- **Reorg & Gap Recovery**: Detects ledger sequence discontinuities. If a gap is detected, the cursor steps back to the last finalized ledger checkpoint and re-streams missing blocks.
- **Idempotent Projections**: Database upserts use composite unique constraints `(transaction_hash, event_index)` to ensure zero duplicates upon replay.

---

## 2. Read-Model REST API & Caching

Powers high-throughput merchant dashboards, payment histories, and mobile queries:
- **Cursor-Based Pagination**: Endpoints (`/v1/payments`, `/v1/escrows`, `/v1/disputes`) use opaque, base64-encoded cursor tokens for deterministic $O(1)$ pagination.
- **Redis Multi-Tier Caching**: Read-through caching for hot merchant balances and payment status lookups with 30-second TTLs.
- **OpenAPI 3.1 Validation**: Strict request/response validation eliminating serialization drift.

---

## 3. Reliable Webhook Delivery Engine

Notifies external merchant ERPs and e-commerce platforms upon payment completion, dispute filing, or refund processing:
- **HMAC-SHA256 Signatures**: Headers include `X-GridPay-Signature: t=1700000000,v1=abc123...` and timestamp to prevent replay attacks.
- **Exponential Backoff**: Failed deliveries retry on a tiered schedule ($5s, 30s, 5m, 30m, 2h$) over 48 hours.
- **Dead-Letter Queue (DLQ)**: Permanently failing webhooks are stored in `webhook_dead_letter` for merchant manual re-delivery.

---

## 4. SEP-10 / SEP-53 Wallet Authentication & Scoped RBAC

- **SEP-10 Challenge-Response**: Clients sign a standard Stellar transaction challenge with their wallet secret/key.
- **Scoped API Keys**: Merchants generate granular keys (`payments:read`, `refunds:write`, `webhooks:admin`) with IP allowlists.
- **Role-Based Access Control**: Distinguishes Customer, Merchant, Arbitrator, and Protocol Admin tiers.
