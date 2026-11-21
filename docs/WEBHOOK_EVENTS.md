# Webhook Event Specifications

Cypher GridPay emits strongly-typed webhook events to configured merchant endpoints.

## Event Types

- `payment.created` — Payment intent created with pending status.
- `payment.settled` — Payment confirmed onchain with finalized ledger sequence.
- `payment.failed` — Payment expired or rejected onchain.
- `escrow.disputed` — Escrow locked in dispute; arbitrator panel assigned.
- `refund.issued` — Refund processed and credited to customer account.
