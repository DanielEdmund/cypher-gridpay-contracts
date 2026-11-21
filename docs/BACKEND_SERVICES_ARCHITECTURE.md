# Cypher GridPay Backend Services Architecture

This document specifies the core backend supporting services powering Cypher GridPay:
1. Gasless Fee-Bump Relayer Service (Issue #451)
2. Scheduled Execution & Dunning Crank Worker (Issue #452)
3. Hosted Checkout Session & Payment Intent Lifecycle Service (Issue #458)

---

## 1. Gasless Fee-Bump Relayer Service

Mainstream GridPay customers paying utility bills or merchant invoices with USDC often hold 0 XLM for Stellar transaction fees. The Relayer Service abstracts fee management:

- **Fee-Bump Mechanics**: Constructs a Stellar `FeeBumpTransaction` wrapping the user's pre-authorized transaction.
- **Merchant Sponsorship**: Merchants configure monthly sponsorship quotas or per-transaction fee subsidies.
- **Relayer Stipend Settlement**: When executing on-chain contracts, the contract transfers a configured fee stipend to the relayer account (`test_relayer_stipend.rs`).
- **Quota & Sybil Protection**: Daily volume limits per IP, wallet age verification, and CAPTCHA gates for anonymous checkout sessions.

---

## 2. Scheduled Execution & Dunning Crank Worker

Because Soroban smart contracts cannot execute themselves on a wall-clock timer, the off-chain Crank Worker triggers time-dependent lifecycle state transitions:

- **Scheduled Payments**: Polls upcoming payments and triggers `execute_scheduled_payment`.
- **Recurring Subscriptions**: Evaluates recurring billing periods and calls `execute_recurring_payment`.
- **Subscription Dunning**: Manages retries for failed subscriptions (`retry_failed_payment`) with exponential backoff before triggering auto-cancellation or grace period suspension.
- **Leader Election**: Redis redlock cluster prevents duplicate execution across multi-region worker replicas.

---

## 3. Hosted Checkout Session & Payment Intent Lifecycle

The Checkout Lifecycle Service provides e-commerce merchants with a Stripe-like checkout experience:

- **Payment Intent Creation**: Generates unique `session_id`, sets expiration window (default 15 minutes), and binds metadata (order ID, items, delivery address).
- **Idempotency**: Requests enforce `Idempotency-Key` headers to prevent double-charging.
- **WebSocket Streaming**: Broadcasts live payment confirmation events to customer checkout pages upon contract event emission.
