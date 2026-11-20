# Advanced Escrow Extensions & Dispute Arbitration Hardening

This document specifies advanced smart-contract escrow extensions and anti-collusion mechanisms across `core/contracts/escrow` and `core/contracts/refund`.

---

## 1. Sealed-Bid Tender Deposit Escrow (`TenderDepositEscrow`)

In energy procurement auctions and infrastructure contractor RFPs, bidders post earnest-money deposits:
- **Bid Commitment**: Bidders submit `sha256(bid_amount || salt)` alongside their locked collateral deposit.
- **Atomic Loser Refund**: Upon auction finalization, losing bidders' escrow deposits are refunded automatically in a single batch transaction.
- **Winner Conversion**: The winning bidder's deposit converts automatically into a performance bond or downpayment held under milestone escrow rules.

---

## 2. Hash Time-Locked Contract (HTLC) Atomic Swap Escrow

Supports cross-chain settlement bridges (e.g. Bitcoin Lightning, EVM stablecoin rails, and Stellar Soroban):
- **Secret Preimage**: Funds are locked until the counterparty reveals `R` where `sha256(R) == H`.
- **Time-Locked Expiry**: If `R` is not revealed before the expiration ledger sequence, the original depositor can reclaim all locked collateral without arbitrator intervention.
- **Reentrancy Protection**: Integrated with `reentrancy.rs` guards to prevent dual-spend races.

---

## 3. Arbitrator Conflict-of-Interest Cooldown Registry (`ArbitratorCooldownRegistry`)

Prevents repeat-pair collusion between merchants and arbitrators:
- **Pairing Frequency Limits**: Tracks the rolling dispute count between any `(merchant, arbitrator)` pair.
- **Cooldown Window**: An arbitrator who resolved a dispute for a merchant cannot be selected for another dispute involving that same merchant for a mandatory cooldown window (e.g., 30 days or 50,000 ledgers).
- **Mandatory Recusal**: `select_arbitration_panel` checks the registry and rejects candidates with active cooldowns.

---

## 4. Statutory Jurisdiction Refund Floors (`JurisdictionRefundFloor`)

Prevents predatory merchant refund policies from overriding consumer law:
- **Regional Regulatory Floors**: Binds minimum cancellation windows (e.g., 14-day EU statutory right of withdrawal).
- **Enforcement Precedence**: When evaluating `request_refund`, the contract calculates `max(merchant_policy_refund, statutory_jurisdiction_floor)`.
