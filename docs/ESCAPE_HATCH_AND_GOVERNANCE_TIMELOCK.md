# Protocol Escape-Hatch Recovery & Governance Timelock Queue

This document specifies the self-custodial recovery and governance safety mechanisms across `orchestrator/contracts/admin` and related core contracts.

---

## 1. Protocol Escape-Hatch Recovery Mode (`activate_escape_hatch`)

### The Centralization / Deadlock Risk
While `AdminContract::emergency_pause_all` protects protocol funds against active zero-day exploits, an indefinite pause caused by lost admin multisig keys or governance deadlock poses an existential custody risk to users.

### The Immutable Escape Hatch Invariant
1. **Pause Duration Clock**: When `emergency_pause_all` is triggered, the contract records the ledger sequence.
2. **Ceiling Threshold**: If the pause duration exceeds `MAX_PAUSE_CEILING_LEDGERS` (e.g. 14 days / 241,920 ledgers) without unpausing:
   - Any user, merchant, or depositor can invoke `activate_escape_hatch()`.
   - The contract irreversibly enters `EscapeHatchActive` mode.
3. **Self-Custodial Fund Reclaim**:
   - Buyers with pending payments or unreleased escrows can withdraw their locked funds directly.
   - Merchants can withdraw undisputed balance allocations.
   - No multisig or admin signature is required or able to veto escape claims.

---

## 2. Timelocked Parameter Governance Queue & Guardian Veto Window

- **Two-Phase Commit**: Parameter mutations (`sync_protocol_parameters`, `set_treasury_allocation`) must be proposed and enter a mandatory time delay queue (minimum 48 hours).
- **Guardian Veto**: Designated emergency guardians can cancel malicious proposals during the timelock window before execution.

---

## 3. Cross-Contract Schema Compatibility Handshake (`verify_peer_compatibility`)

- Before an upgrade or contract rotation is committed, the new contract must execute a cross-contract compatibility handshake (`verify_peer_compatibility`) verifying schema version numbers across Payment, Escrow, Refund, and Admin contracts.
- Incompatible interface versions abort the proposal atomically.

---

## 4. Merchant-Initiated Goodwill Store-Credit Issuance (`issue_goodwill_voucher`)

- Merchants can issue store credits/vouchers proactively to resolve customer dissatisfaction.
- Bounded by daily and monthly budget caps defined in merchant storage to prevent unauthorized drain.
