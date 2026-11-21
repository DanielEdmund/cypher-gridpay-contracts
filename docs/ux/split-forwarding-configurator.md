# Split-Payment & Forwarding Flow Configurator — UX Specification

**Issue:** #419  
**Status:** Draft  
**Affected component:** `apps/web/src/components/splits/SplitAllocationEditor.tsx`

---

## 1. Overview

Non-technical merchants need a way to configure `PaymentSplitConfig` (basis-point splits across multiple recipients) and `PaymentForwardConfig` (downstream forwarding rules) without reasoning about raw integers like `3333`, `3333`, `3334`. This specification defines a split-screen visual editor that makes the allocation immediately legible and catches configuration errors before they reach the contract.

The on-chain constraint is that all `share_bps` values must sum to exactly **10 000** (representing 100.00%). One basis point equals **0.01%**; fractional basis points cannot be represented and must be rejected at input time.

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Split & Forwarding Configurator                                      │
├─────────────────────────────┬────────────────────────────────────────┤
│  LEFT PANE — Controls       │  RIGHT PANE — Live Flow Preview        │
│                             │                                        │
│  [Recipient rows]           │  [Sankey / node-edge diagram]          │
│  [Action toolbar]           │  [Error callout overlay]               │
└─────────────────────────────┴────────────────────────────────────────┘
```

On viewports narrower than 768 px the panes stack vertically, with the flow preview collapsing to a compact summary table.

---

## 3. Left Pane — Controls

### 3.1 Recipient Rows

Each row represents one `SplitRecipient` and contains:

| Field | Detail |
|-------|--------|
| **Address** | Free-text input validated as a valid Stellar `G…` or `C…` address. Duplicate addresses show an inline red error immediately on blur. |
| **Allocation input** | Numeric field that switches between two modes (see §3.2). |
| **Mode toggle** | A pill toggle: `%` ↔ `bps`. Switching converts the displayed value without changing the underlying basis-point integer. |
| **Dust-sink indicator** | A ★ (star) button on each row. Exactly one row may be starred at a time. The starred recipient automatically absorbs any rounding remainder so the total stays at 10 000 bps. Only one star may be active; activating another deactivates the previous. |
| **Remove button** | Trashes the row. Disabled when only one row remains. |

Rows are reorderable via keyboard (see §5) but drag-and-drop is optional.

The minimum recipient count is **1**; the maximum is determined by the contract's `MAX_SPLIT_RECIPIENTS` constant (read from contract metadata on load, defaulting to **10** if unavailable).

### 3.2 Input Modes

**Percentage mode (`%`)**  
- Accepts values with up to two decimal places (e.g. `33.33`).  
- Values are stored and transmitted as `Math.round(value * 100)` basis points.  
- Typing `33.333` is blocked at the third decimal place; the field rejects the keypress.

**Basis-point mode (`bps`)**  
- Accepts non-negative integers only. The decimal point key is blocked.  
- Maximum value per field: `10000`.

### 3.3 Action Toolbar

Located below the recipient rows:

| Button | Behaviour |
|--------|-----------|
| **+ Add Recipient** | Appends a new empty row (disabled when at `MAX_SPLIT_RECIPIENTS`). |
| **Split Evenly** | Divides 10 000 bps as evenly as possible among all rows. If 10 000 is not evenly divisible, the remainder goes to the dust-sink row (the starred one, or the last row if none is starred). |
| **Fill Remaining %** | Sets the focused row's allocation to `10000 − sum(all other rows)`. Disabled if that result would be negative or zero. |
| **Reset** | Clears all rows back to a single empty row. Asks for confirmation if any rows have data. |

### 3.4 Forwarding Rules Section

Below the split rows, an expandable **Forwarding Rules** accordion lists `PaymentForwardConfig` entries. Each entry has:

- **Merchant address** (read-only label, pre-filled from wallet context)  
- **Forward-to address** (validated Stellar address)  
- **Forward basis points** (0–10 000, same mode toggle as above)  
- **Active toggle** (on/off switch mapping to `active: bool`)

A **+ Add Forwarding Rule** button appends a new entry. Each rule is independent of the split total and does not need to sum to 10 000.

---

## 4. Right Pane — Live Flow Preview

### 4.1 Diagram Type

An **interactive Sankey / directed node-edge flow diagram** rendered with an SVG-based library (e.g. D3-Sankey or React Flow). The diagram updates in real time as the user edits left-pane fields — no submit required.

### 4.2 Fixed Example Amount

The diagram always uses **100.00 USDC** as the example incoming payment. This makes percentages immediately human-readable regardless of real payment amounts.

### 4.3 Node Layout

```
[Customer  100.00 USDC]
        │
        ▼
[Protocol Fee node]  ← deducted first; labelled with fee_bps value
        │
        ├──► [Recipient A  33.33 USDC]  ──► [Forward → Sub-wallet X  10.00 USDC]
        │
        ├──► [Recipient B  33.33 USDC]
        │
        └──► [Recipient C (★)  33.34 USDC]
```

- Edge width is proportional to the USDC amount flowing along it.
- Each node shows the recipient's truncated address (`G…XYZ`) and the USDC amount.
- Forwarding hops appear as child nodes connected by a dashed edge.
- The Protocol Fee node is always present and uses `base_fee_bps` from contract config (default 50 bps / 0.50% if unavailable). Its value is shown but is not editable from this UI.

### 4.4 Interaction

- Hovering a node highlights all edges connected to it and shows a tooltip with the full address, exact bps, and USDC equivalent.
- Hovering an edge shows the exact flow amount.
- The diagram is fully keyboard-navigable: Tab moves between nodes, Enter opens the tooltip.

### 4.5 Responsive Fallback

When the viewport is too narrow to render the diagram, the right pane shows a compact allocation table:

| Recipient | bps | % | USDC (of 100) |
|-----------|-----|---|---------------|
| G…AAA | 3333 | 33.33% | 33.33 |
| G…BBB | 3333 | 33.33% | 33.33 |
| G…CCC ★ | 3334 | 33.34% | 33.34 |

---

## 5. Inline Error Callouts

Errors appear as inline banners directly below the relevant input or as highlighted edges in the diagram. All errors block the **Save Configuration** button.

### 5.1 Total ≠ 10 000 bps

A sticky banner at the bottom of the left pane shows:

> **Total: 9 999 bps (99.99%) — 1 bps short of 100%.**  
> Use "Fill Remaining %" on a row, or activate the dust-sink on a recipient.

The allocation bar (a horizontal progress bar above the toolbar) fills proportionally and turns red when over 10 000 or yellow when under.

### 5.2 Duplicate Addresses

The row with the duplicate address shows a red border and the message:

> **Duplicate address — each recipient must be unique.**

### 5.3 Forwarding Cycle Detection

When a cycle is present in the forwarding graph (e.g. A → B → C → A), the diagram:

1. Highlights the closing edge in **red** with a dashed stroke.
2. Shows a callout banner:

> **Cycle detected:** `G…AAA` → `G…BBB` → `G…CCC` → **`G…AAA`** forms a loop.  
> Remove or redirect the highlighted forwarding rule to continue.

The cyclic edge label shows `⚠ LOOP` in red. The **Save Configuration** button is disabled until the cycle is resolved.

Cycle detection runs on every change using a standard depth-first-search over the forwarding-rule graph.

### 5.4 Fractional Basis Points

If a user enters a percentage with more than two decimal places (e.g. `33.333%`), the input rejects the character in real time and shows:

> **Maximum precision is 0.01% (1 bps). Fractional basis points cannot be represented on-chain.**

---

## 6. Accessibility

- All recipient row controls are reachable and operable with keyboard alone.
- Row order changes via `Alt+↑` / `Alt+↓` on the focused row.
- The star (dust-sink) toggle is activated with `Space` or `Enter`.
- Color is never the sole indicator of an error — every error has a text label.
- The diagram nodes are in the tab order and announce their content via `aria-label` (e.g. "Recipient G…XYZ, 33.33 percent, 33.33 USDC").
- The allocation progress bar has `role="meter"` with `aria-valuenow`, `aria-valuemin="0"`, and `aria-valuemax="10000"`.

---

## 7. Data Model Mapping

| UI concept | Contract field |
|------------|----------------|
| Recipient row | `SplitRecipient { address, share_bps }` |
| Split configuration | `PaymentSplitConfig { payment_id, recipients, executed }` |
| Forwarding rule | `PaymentForwardConfig { merchant, forward_to, forward_bps, active }` |
| Dust-sink row | The starred recipient that receives the remainder bps |
| Protocol Fee node | `base_fee_bps` from contract `FeeConfig` |

The editor serialises state to these exact shapes before calling the contract. `payment_id` is passed in as a prop or resolved from URL params; `executed` is always `false` for new configurations.

---

## 8. Edge Cases & Invariants

| Scenario | Behaviour |
|----------|-----------|
| Single recipient | Allocation locked to 10 000 bps; input disabled with tooltip "Single recipient receives 100%." |
| All rows cleared to 0 | Total bar shows 0 bps; Save blocked. |
| Recipient count at MAX | "+ Add Recipient" button is disabled with tooltip "Maximum N recipients reached." |
| Forward-to address equals a split recipient | Allowed; displayed as an intra-graph edge. |
| `forward_bps = 0` | Warning: "A zero-bps forwarding rule has no effect." |
| Protocol fee leaves < 1 bps per recipient | Warning shown in flow preview. No hard block (enforced on-chain). |
| Paste of a non-Stellar address | Address field shows "Invalid Stellar address" on blur. |

---

## 9. Acceptance Criteria

- [ ] Visual editor covers percentage/bps toggle, auto-balance ("Split Evenly", "Fill Remaining %"), dust-sink star indicator, and live Sankey/node flow preview updating in real time.
- [ ] Cycle detection warning is unmistakable: the cyclic edge is highlighted red with a `⚠ LOOP` label, and the banner names every address in the loop in order.
- [ ] Keyboard editing works across all recipient rows without requiring drag-and-drop (Tab navigation, `Alt+↑`/`Alt+↓` reorder, Space/Enter for star toggle).
- [ ] Fractional basis-point input is blocked at the keystroke level in percentage mode beyond two decimal places.
- [ ] The flow preview renders cleanly for 1 through `MAX_SPLIT_RECIPIENTS` recipients without label overlap (tested at 10 recipients).
- [ ] All errors (total mismatch, duplicate address, cycle) disable the Save Configuration button and show descriptive text messages — not colour alone.
- [ ] The allocation progress bar exposes `role="meter"` and correct ARIA attributes.

---

## 10. Open Questions

1. Should the Protocol Fee be editable from this screen (requires admin role), or always read-only?
2. What is the definitive value of `MAX_SPLIT_RECIPIENTS` exposed by the contract?
3. Should forwarding rules be validated against the current split recipients list, or are arbitrary on-chain addresses acceptable?
