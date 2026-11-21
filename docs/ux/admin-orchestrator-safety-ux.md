# Admin Orchestrator Safety UX — Specification

**Issue:** #413  
**Status:** Draft  
**Affected components:**
- `apps/web/src/components/admin/EmergencyPauseModal.tsx`
- `apps/web/src/components/admin/ContractHealthMatrix.tsx`

---

## 1. Overview

The Admin Orchestrator (`orchestrator/contracts/admin`) exposes high-stakes operations — `emergency_pause_all`, `execute_upgrade`, `execute_payment_rotation` — where a single accidental execution on Mainnet can halt all protocol commerce or permanently break cross-contract routing. The admin UX must achieve two goals simultaneously:

1. **Speed under pressure**: A P0 incident responder must be able to issue `emergency_pause_all` in under 20 seconds from page load.
2. **Fat-finger prevention**: The same action must be impossible to execute accidentally during normal review sessions.

This specification defines three interlocking design systems:

- **Environment Banner** — persistent, unambiguous network identification on every admin screen.
- **Calibrated Friction Modals** — confirmation depth scaled to action destructiveness.
- **System Health Heartbeat** — always-visible contract status matrix with one-click drill-down.

---

## 2. Environment Banner

### 2.1 Purpose

Every admin screen must display the active network at all times. An admin who performs a destructive action on Mainnet while believing they are on Testnet is a protocol-level risk.

### 2.2 Visual Design

The banner is a full-width, non-dismissible strip pinned to the very top of the viewport (above even the global navigation). It is **8 px tall on idle** and expands to **32 px on hover/focus** to show the full label. This keeps it out of the way during normal work while remaining impossible to miss.

#### Mainnet

| Property | Value |
|----------|-------|
| Background | `#7F1D1D` (crimson-900) |
| Top hairline | `3px solid #EF4444` (red-500) |
| Pill text | `MAINNET` |
| Pill bg | `#EF4444` |
| Pill text color | `#FFFFFF` |
| Body text | "You are operating on the live Stellar Mainnet. All actions are irreversible." |

#### Testnet

| Property | Value |
|----------|-------|
| Background | `#1E1B4B` (indigo-950) |
| Top hairline | `3px solid #6366F1` (indigo-500) |
| Pill text | `TESTNET` |
| Pill bg | `#6366F1` |
| Pill text color | `#FFFFFF` |
| Body text | "You are on Testnet. No real funds or contracts are affected." |

#### Localnet / Standalone

| Property | Value |
|----------|-------|
| Background | `#1E293B` (slate-800) |
| Top hairline | `3px solid #64748B` (slate-500) |
| Pill text | `LOCALNET` |
| Pill bg | `#64748B` |
| Pill text color | `#FFFFFF` |
| Body text | "Local development environment." |

### 2.3 Behavior

- **Non-dismissible** — no close button under any circumstances.
- **Role/ARIA** — `role="banner"` on the outer element; `aria-label="Network: Mainnet"` (or appropriate network).
- On **Mainnet only**, the hairline pulses (CSS `animation: pulse 2s infinite`) to draw attention if the banner has been idle for more than 60 seconds without user interaction on the page.

---

## 3. Calibrated Friction Modal System

Admin actions are categorized into two friction tiers. The tier is determined by the action's destructiveness, not by the caller's judgment.

### 3.1 Tier Classification

| Action | Tier | Confirmation Required |
|--------|------|-----------------------|
| Update fee parameter | Standard | Diff table + single confirm |
| Update rate-limit thresholds | Standard | Diff table + single confirm |
| Add/remove authorized address | Standard | Diff table + single confirm |
| Execute payment rotation | High-Impact | Diff + checksum + typed phrase + justification |
| Execute WASM upgrade | High-Impact | Diff + checksum + typed phrase + justification |
| Emergency pause (subsystem) | High-Impact | Diff + typed phrase + justification |
| Emergency pause all | High-Impact (P0) | Diff + typed phrase + justification + 5 s countdown |

### 3.2 Standard Friction Modal

```
┌──────────────────────────────────────────────────────────────┐
│  Confirm: Update Fee Parameter                          [×]  │
│                                                              │
│  Review the change before confirming.                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Parameter        Old Value    New Value               │  │
│  │  ─────────────────────────────────────────             │  │
│  │  base_fee_bps     50           75         ▲ +25        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Signing address: G…ABCD  ·  2-of-3 multisig required       │
│                                                              │
│  [Cancel]                           [Confirm Change →]      │
└──────────────────────────────────────────────────────────────┘
```

**Diff table rules:**
- Each changed field occupies one row: Parameter name | Old value | New value | Delta indicator.
- Addresses are shown in full with character grouping (groups of 4, monospace): `GABC DEF1 2345 …`
- Unchanged fields are hidden by default; a "Show all fields" toggle reveals them.
- Deletions (old value removed) render in red; additions (new value added) render in green; modifications render old in amber and new in green.

### 3.3 High-Impact Friction Modal

Extends the Standard modal with three additional guards:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠ HIGH-IMPACT ACTION — Execute WASM Upgrade           [×]  │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  [Diff table — same as Standard]                             │
│                                                              │
│  ── WASM Checksum Verification ──────────────────────────    │
│  Expected SHA-256:                                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  a3f4 b1c2 d5e6 f7a8  9b0c 1d2e 3f4a 5b6c             │  │
│  │  7d8e 9f0a 1b2c 3d4e  5f6a 7b8c 9d0e 1f2a             │  │
│  └────────────────────────────────────────────────────────┘  │
│  ✓ Hash matches uploaded WASM artifact                       │
│                                                              │
│  ── Typed Confirmation ──────────────────────────────────    │
│  Type  UPGRADE PAYMENT  to confirm:                          │
│  [                                              ]            │
│                                                              │
│  ── Incident Justification (required) ──────────────────     │
│  [ Post-mortem / ticket link or brief description…      ]   │
│  [ (min 20 characters)                                  ]   │
│                                                              │
│  [Cancel]           [I confirm — Execute Upgrade →]         │
│                     (button disabled until all guards pass)  │
└──────────────────────────────────────────────────────────────┘
```

#### Guard 1 — SHA-256 Checksum Verification Badge

- Displayed only for WASM upgrade actions.
- Shows the expected hash in 4-character groups, 2 groups per segment, 8 segments per row (standard 64-hex SHA-256 layout).
- A verification indicator shows one of three states:
  - **Verifying…** — hash comparison in progress (spinner).
  - **✓ Hash matches** — green badge; proceeding is permitted on this guard.
  - **✗ Hash mismatch** — red badge; Confirm button remains disabled regardless of other guards.

#### Guard 2 — Typed Confirmation Phrase

- Phrase is unique per action type and network:
  - `PAUSE MAINNET` — emergency pause all on Mainnet.
  - `PAUSE [SUBSYSTEM]` — subsystem-specific pause (e.g. `PAUSE ESCROW`).
  - `UPGRADE [CONTRACT]` — WASM upgrade (e.g. `UPGRADE PAYMENT`).
  - `ROTATE PAYMENT` — payment rotation.
- Phrase is shown above the input field in a monospace code block so the user can copy it visually without ambiguity.
- Input comparison is case-sensitive and whitespace-exact.
- The input field has `autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"` to prevent browsers from altering the phrase.

#### Guard 3 — Incident Justification Field

- Free-text `<textarea>`, minimum 20 characters.
- Placeholder: "Post-mortem ticket, incident ID, or brief justification…"
- Character counter shown at bottom-right.
- This text is logged on-chain or to an off-chain audit trail — the label states this explicitly: "This text will be recorded in the audit log."

#### P0 Override — Emergency Pause All Countdown

For `emergency_pause_all` on Mainnet only, after all three guards pass and the Confirm button becomes active, clicking it starts a **5-second animated countdown** before the transaction is submitted. During the countdown:
- A large countdown display (`5… 4… 3… 2… 1…`) fills the modal.
- An **Abort** button remains visible and active throughout.
- If `Abort` is clicked, the countdown resets; no transaction is submitted.
- If the countdown completes, the transaction is submitted automatically.

This design gives the responder speed (no second click needed) while providing a final escape hatch.

### 3.4 Confirm Button States

| State | Appearance | Condition |
|-------|-----------|-----------|
| Idle/disabled | `opacity: 0.35`, `cursor: not-allowed` | Any guard not yet satisfied |
| All guards passed | Full opacity, green background | All guards satisfied |
| Countdown active | Replaced by countdown display | P0 pause only |
| Submitting | Spinner + "Submitting…" | Transaction in-flight |
| Success | Green checkmark + "Done" | Transaction confirmed |
| Error | Red × + error message | Transaction rejected |

---

## 4. System Health Heartbeat

### 4.1 Purpose

The Health Heartbeat gives every admin user an at-a-glance status of all four contracts simultaneously. It lives in the persistent admin header and is always visible — never behind a navigation click.

### 4.2 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  System Health                                    Last sync: 4s ago  │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ ● Payment│  │ ● Escrow │  │ ● Refund │  │ ● Admin  │           │
│  │  Healthy │  │  Healthy │  │ ⚠ Warn  │  │  Healthy │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└──────────────────────────────────────────────────────────────────────┘
```

Each tile is a clickable card that opens a drill-down panel (see §4.4).

### 4.3 Traffic-Light Status Definitions

| Status | Indicator color | Dot color | Meaning |
|--------|----------------|-----------|---------|
| Healthy | `#DCFCE7` bg / `#166534` text | `#22C55E` (green) | Contract operating normally; all checks pass |
| Warning | `#FEFCE8` bg / `#713F12` text | `#EAB308` (amber) | Non-critical issue: TTL < 20% remaining, schema version mismatch pending, or 1 of N multisig approvals missing |
| Critical | `#FEF2F2` bg / `#7F1D1D` text | `#EF4444` (red) | Contract paused, circuit breaker active, or unrecoverable error state |
| Unknown | `#F9FAFB` bg / `#4B5563` text | `#9CA3AF` (gray) | Cannot reach contract; RPC timeout |

Dark mode equivalents use the same hue families at reduced lightness (bg darkened, text lightened).

### 4.4 Drill-Down Panel

Clicking a tile expands (or opens as a side panel on desktop) a detailed view:

```
┌────────────────────────────────────────────────────────┐
│  Payment Contract                              [Close]  │
│  ● Healthy — last checked 4 s ago                      │
│                                                        │
│  Schema version:    v3 (current)                       │
│  TTL remaining:     1,842,310 ledgers (~120 days)      │
│  Storage entries:   2,041                              │
│                                                        │
│  Multisig approvals                                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Pending action: upgrade_wasm                    │  │
│  │  Approvals:  2 / 3  ██████████░░░░  [Approve]   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Recent events (last 10)                               │
│  13:42 UTC  payment_processed   tx: ABCD…1234          │
│  13:41 UTC  fee_updated         50 bps → 75 bps        │
└────────────────────────────────────────────────────────┘
```

Fields shown:
- **Schema version** — current vs. expected; mismatch shown in amber.
- **TTL remaining** — ledger count + human approximation (days); < 20% triggers Warning status.
- **Storage entries** — informational count.
- **Pending multisig actions** — each pending action shows approval progress bar + Approve button for active signers.
- **Recent events** — last 10 events from the contract, with timestamp, event type, and truncated tx hash.

---

## 5. Auditor vs. Signer View

Admins may hold one of two roles:

| Role | Buttons | Indicators |
|------|---------|------------|
| **Active Multisig Signer** | Confirm, Approve, Abort, Execute buttons are fully interactive | No special indicator needed |
| **Read-Only Auditor** | All action buttons render as `disabled` with a lock icon and tooltip "You have view-only access on this network" | A persistent `AUDITOR VIEW` badge in the admin header next to the network pill |

The distinction is enforced by a prop (`viewerRole: "signer" | "auditor"`) passed to all admin components. Auditors never see broken or mysteriously-disabled UI — the reason is always explicit.

---

## 6. Incident Response Fast Path

The Emergency Pause button is **always visible** in the persistent admin header, regardless of which admin sub-page is active. It is styled with a red background even in its idle state to signal its severity, but requires the full High-Impact modal flow to execute.

```
Admin Header:
[MAINNET ▪] [System Health tiles] ……… [⬛ Emergency Pause]
```

This satisfies the < 20-second P0 target:
- Button always visible: **0 s navigation**
- Modal opens instantly: **~0.5 s**
- Diff loads (pre-fetched on header mount): **~1 s**
- Typed phrase input: **~5–8 s**
- Justification field (brief entry): **~5–8 s**
- P0 countdown completes: **5 s**
- **Total: ~16–22 s** (within target for a typed-phrase guard)

---

## 7. Diff View Character Grouping

Addresses and hashes in diff tables are displayed in **4-character groups** in a monospace font to enable human verification by chunking:

```
Old:  GABC DEFG H123 456J K789 0LMN OPQR STUV WXYZ A1B2
New:  GABC DEFG H123 456J K789 0LMN OPQR STUV WXYZ A1B3
                                                       ↑ changed
```

Changed characters within an address are highlighted at the character level (red background on old, green background on new) in addition to the row-level color coding.

---

## 8. Accessibility

- All modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to title, focus trap, Escape to cancel.
- Countdown display: `aria-live="assertive"` so screen readers announce each second.
- Diff table: `role="table"` with proper `<thead>` / `<tbody>` / `scope` attributes.
- Status tiles: `role="button"` with `aria-label="Payment contract: Healthy — click for details"`.
- Typed confirmation input: `aria-describedby` pointing to the phrase display element.
- Checksum badge: `aria-label` reflects current verification state.
- Confirm button: `aria-disabled="true"` with `aria-describedby` naming which guard(s) remain.
- Auditor-disabled buttons: `aria-disabled="true"` + tooltip "View-only access" — never `disabled` attribute alone.

---

## 9. Acceptance Criteria

- [ ] Environment banner present on all admin screens for Mainnet (crimson), Testnet (indigo), and Localnet (slate), non-dismissible, with `role="banner"`.
- [ ] Standard friction modal shows diff table with character-grouped addresses and old/new highlighting; single Confirm button.
- [ ] High-Impact friction modal adds SHA-256 checksum badge, typed confirmation phrase, and incident justification field; Confirm disabled until all three pass.
- [ ] `emergency_pause_all` on Mainnet includes a 5-second abort-able countdown after all guards are satisfied.
- [ ] System Health Heartbeat shows all 4 contracts (Payment, Escrow, Refund, Admin) as traffic-light tiles with Healthy/Warning/Critical/Unknown states, always visible in admin header.
- [ ] Drill-down panel shows schema version, TTL remaining, pending multisig approvals with progress bar, and recent events.
- [ ] Auditor vs. signer role distinction is visually explicit — auditor sees disabled buttons with lock icon and "AUDITOR VIEW" badge, never silently broken UI.
- [ ] Emergency Pause button always visible in admin header (no deep navigation required) — P0 pause executable in < 20 seconds.
- [ ] All components pass keyboard navigation and ARIA attribute checks.
