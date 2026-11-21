# Real-Time Streaming Micro-Payment Channel Dashboard & kWh Runway Telemetry UX

**Issue:** [#416](https://github.com/johnephraim949-web/cypher-gridpay-contracts/issues/416)
**Status:** Draft
**Last Updated:** 2026-11-21

---

## Table of Contents

1. [Overview](#overview)
2. [Key Vocabulary](#key-vocabulary)
3. [Streaming Channel Card Layout](#streaming-channel-card-layout)
   - [Live Flow-Rate Badge](#live-flow-rate-badge)
   - [Flow Animation Indicator](#flow-animation-indicator)
   - [Dual-Segment Progress Bar](#dual-segment-progress-bar)
   - [Runway Indicator](#runway-indicator)
   - [Quick Top-Up Pill](#quick-top-up-pill)
4. [Channel Detail Layout](#channel-detail-layout)
   - [Mutual Close vs. Unilateral Dispute Close](#mutual-close-vs-unilateral-dispute-close)
5. [Anti-Jitter Numeric Display Standard](#anti-jitter-numeric-display-standard)
6. [Reduced-Motion Alternative](#reduced-motion-alternative)
7. [Edge Cases & State Invariants](#edge-cases--state-invariants)
8. [Responsive Layout](#responsive-layout)
9. [Accessibility](#accessibility)
10. [Verification Checklist](#verification-checklist)

---

## Overview

Continuous per-second energy/utility streaming channels (`StreamingChannel`) behave differently
from discrete invoices: balances change continuously, runway depletes in real time, and sudden
channel exhaustion can interrupt metered energy services. This spec defines an intuitive visual
language for **flow rate**, **accrued value**, and **remaining runway**.

The goal is a dashboard that lets a merchant glance at a channel card and instantly answer:

- *How fast is money/energy flowing right now?*
- *How much is claimable right now vs. already claimed?*
- *How long until the funded buffer runs out?*
- *What happens if I close this channel?*

---

## Key Vocabulary

| Term | Meaning |
|---|---|
| **Flow rate** | Rate of accrual, e.g. `0.0042 USDC/min` ≈ `2.5 kWh/hr` |
| **Claimed** | Value already settled and claimed by the receiver (immutable segment) |
| **Accrued (Claimable Now)** | Value accrued since last claim, withdrawable immediately |
| **Remaining (Funded Buffer)** | Deposited funds not yet streamed — the runway source |
| **Runway** | Estimated time until the funded buffer is exhausted at current flow rate |
| **Mutual Close** | Both parties sign → instant settlement, no delay |
| **Unilateral Close** | One party initiates → enters a challenge window before settlement |

---

## Streaming Channel Card Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ◌  Channel #CH-7421 · Energy Feed                    [ ⋯ ]   │
│  ──────────────────────────────────────────────────────────── │
│                                                              │
│  ⟶ 0.0042 USDC/min  ·  ~2.5 kWh/hr                ● Live       │
│                                                              │
│  Claimed      Accrued (Claimable Now)    Remaining Buffer     │
│  ┌────────────────────────────────────┐  ┌────────────────┐  │
│  │████████████████████████│░░░░░░░░░░░░│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  │
│  │ 62.3 USDC   │ 8.1 USDC  │ 29.6 USDC │  │  Pending top-up │  │
│  └────────────────────────────────────┘  └────────────────┘  │
│                                                              │
│  ⏱ Runway: 18h 42m                       [ amber < 24h ]     │
│     [+10 USDC] [+50 USDC] [Custom ▾]                         │
│                                                              │
│  [ Mutual Close ]            [ Unilateral Close → ]          │
└──────────────────────────────────────────────────────────────┘
```

### Live Flow-Rate Badge

A persistent badge at the top of the card showing the current streaming rate in both
monetary and energy units.

```
⟶ 0.0042 USDC/min  ·  ~2.5 kWh/hr                ● Live
```

**Specification:**

- Monetary rate uses `tabular-nums` monospace digits: `0.0042 USDC/min`.
- Energy rate shown as approximate (`~`) since conversion depends on local tariff: `~2.5 kWh/hr`.
- The `⟶` glyph and the `● Live` status dot sit on either side of the rate.
- The `Live` dot pulses with a 1.6s breathing animation (opacity 1 → 0.4 → 1) while the
  channel is actively streaming, and becomes a static filled dot when **paused** or **depleted**.
- All numeric fields use a **fixed-width character box** (see
  [Anti-Jitter Numeric Display Standard](#anti-jitter-numeric-display-standard)) so the
  label row never shifts as digits roll from `1` → `8` → `0`.

### Flow Animation Indicator

A subtle horizontal "flow" animation runs across the card header underline to reinforce
the sense of continuous streaming.

**Default (motion enabled):**

- A 2px gradient bar (transparent → channel accent → transparent) translates left-to-right
  across the divider line on a 2.4s linear loop, looping seamlessly.
- The bar is 40% of the card width; easing is linear so the motion reads as "flow" not "slide."

**Reduced motion (`prefers-reduced-motion: reduce`):**

- The animated flow bar is replaced by a **static** gradient underline icon (no
  transform/animation). The flow rate badge continues to update numerically on the
  reduced-motion cadence (see [Reduced-Motion Alternative](#reduced-motion-alternative)).
- The `Live` dot becomes a static filled circle with no pulse.

### Dual-Segment Progress Bar

A single horizontal bar divided into two regions that together represent the channel's
deposit lifecycle.

```
Claimed      Accrued (Claimable Now)    Remaining Buffer
┌────────────────────────────────────┐  ┌────────────────┐
│████████████████████████│░░░░░░░░░░░░│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│ 62.3 USDC   │ 8.1 USDC  │ 29.6 USDC │  │  Pending top-up │
└────────────────────────────────────┘  └────────────────┘
```

**Three logical segments, two visual bars:**

| Segment | Visual treatment | Meaning |
|---|---|---|
| **Claimed** | Solid fill (channel accent, e.g. `#0072B2`) | Already settled; cannot decrease |
| **Accrued (Claimable Now)** | Hatched/stippled fill in a lighter accent | Streamed but not yet claimed; withdrawable immediately |
| **Remaining (Funded Buffer)** | Separate shorter bar, dotted fill | Deposit not yet streamed; funds the runway |

The Claimed + Accrued segments share one continuous track (their widths are proportional to
`claimed / totalDeposit` and `accrued / totalDeposit`). The Remaining Buffer is a *companion*
bar beneath/beside it representing `remaining / totalDeposit`, so the user sees the full
`claimed + accrued + remaining = 100%` relationship at a glance.

**Segment labels** appear directly under each segment in `tabular-nums`, never inside the bar
(to avoid text overflow as widths change).

**Behavior:**
- Widths update continuously (60fps interpolation) as accrued value ticks.
- When Accrued reaches the point where `claimed + accrued = totalDeposit` (i.e. Remaining = 0),
  the card enters the [Stream Paused / Depleted](#edge-cases--state-invariants) state.
- Hovering a segment reveals a tooltip with the exact value and percentage.

### Runway Indicator

Shows estimated time until the funded buffer is exhausted at the current flow rate.

```
⏱ Runway: 18h 42m                       [ amber < 24h ]
```

**Threshold states** (smooth transition, not a hard swap):

| State | Condition | Color | Label |
|---|---|---|---|
| Neutral | runway > 72h | `#0072B2` (cb-blue) | no label / "Healthy" |
| Amber | runway ≤ 24h | `#F0E442` (cb-yellow) → `#E69F00` (cb-orange) gradient | "amber < 24h" |
| Red | runway ≤ 4h | `#D55E00` (cb-vermillion) | "red < 4h" |
| Depleted | runway = 0 | `#D55E00` (cb-vermillion) | "Depleted — Top up to resume" |

- The numeric countdown (`18h 42m`) uses `tabular-nums` and a **fixed character width** so the
  value ticking down never causes layout shift.
- The transition between states uses a 400ms color crossfade on the label chip, not a hard swap,
  so the eye is drawn to the change without being jarring.
- When runway ≤ 4h (red), the chip also gains a slow 2s pulse outline (suppressed under
  `prefers-reduced-motion`).

### Quick Top-Up Pill

Inline micro-interaction for topping up the channel without leaving the card.

```
[+10 USDC] [+50 USDC] [Custom ▾]
```

**Specification:**
- Three preset options: `+10 USDC`, `+50 USDC`, and a `Custom` dropdown.
- Each pill is a button with a focus ring (2px `#0072B2` outline, 2px offset) for keyboard users.
- Clicking a preset pill triggers the top-up immediately (after a confirm if amount > balance);
  the progress bar Remaining segment animates upward and the runway indicator re-estimates.
- `Custom` opens a small inline popover with a numeric input (monospace digits), a unit label
  (`USDC`), and a "Confirm Top-Up" button. Pressing `Esc` closes it; clicking outside dismisses it.
- After a successful top-up, the pill briefly shows a checkmark (`✓`) for 1.2s before reverting.
- On error (insufficient balance, channel closed), the pill shakes (horizontal translate
  ±4px, 200ms) and shows an inline error message in vermillion below the pills.

---

## Channel Detail Layout

Expanding a channel card (or clicking the `⋯` menu → "View details") opens the detail view,
which contains the full balance ledger, the streaming history sparkline, and the
**Mutual Close vs. Unilateral Dispute Close** comparison sheet.

### Mutual Close vs. Unilateral Dispute Close

A side-by-side comparison sheet that explains the settlement tradeoff clearly:

```
┌─────────────────────────────┬─────────────────────────────┐
│      Mutual Close           │   Unilateral Dispute Close  │
├─────────────────────────────┼─────────────────────────────┤
│  ✓ Instant settlement       │  ⏳ Challenge window delay   │
│  ✓ Both parties sign        │  ◐ One party initiates       │
│  ✓ No on-chain dispute      │  ▲ Dispute may be raised    │
│  ✓ Lowest gas               │  ⚠ Higher gas + timeout      │
│                             │                             │
│  Result: funds settle in    │  Result: funds held in      │
│  the next block.            │  escrow until the challenge  │
│                             │  window (default 48h) ends. │
│                             │                             │
│  Recommended when both       │  Use when the counterparty  │
│  parties are cooperative.   │  is unresponsive or hostile.│
│                             │                             │
│  [ Initiate Mutual Close ]  │  [ Initiate Unilateral → ]  │
└─────────────────────────────┴─────────────────────────────┘
```

**Design rules:**

- The **Mutual Close** column uses the safe accent (`#0072B2`) and checkmarks to signal the
  preferred path.
- The **Unilateral Dispute Close** column uses amber/vermillion cues for the delay/warning rows
  so the cost of the challenge window is visually obvious.
- Each row aligns horizontally across both columns with identical labels so the eye can scan
  the comparison without re-reading.
- The CTA buttons are clearly differentiated: Mutual is primary (filled), Unilateral is
  secondary (outlined) — the visual weight steers cooperative users to the cheaper path while
  still making the fallback discoverable.
- A short explainer line sits beneath the table: *"Mutual signatures settle instantly. Unilateral
  close enters a challenge window so the other party can dispute the final balance."*

---

## Anti-Jitter Numeric Display Standard

Rapidly ticking counters (flow rate, accrued value, runway countdown) must not cause the
surrounding labels to shift horizontally as digits change width (e.g. `1` → `8` → `0`).

**Requirements:**

1. **`font-variant-numeric: tabular-nums`** on every live numeric field so each digit occupies
   an equal advance width.
2. **Monospace font stack** for the most rapidly ticking values (flow rate, accrued counter):
   ```
   font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;
   ```
3. **Fixed-width containers**: each live numeric field is wrapped in a container with a
   `min-width` set to the maximum expected character count (e.g. flow rate container is
   `min-width: 9ch` to hold `0.0042`). This prevents the field's right edge from moving as
   digit widths change even with proportional fallback fonts.
4. **Right-aligned** numeric content within the fixed container so leading-space collapses on
   the left (where it's less noticeable) rather than pushing labels on the right.
5. **No layout-affecting transitions** on numeric updates: only `opacity`/`color` transitions
   are allowed; never `width`, `margin`, or `transform: translateX` on the number itself.

**Example CSS:**

```css
.stream-counter {
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 9ch;        /* holds "0.0042" + unit separator */
  display: inline-block;
  white-space: pre;
}
```

---

## Reduced-Motion Alternative

Users with `prefers-reduced-motion: reduce` (or who toggle a manual "Reduce motion" setting)
get a clean periodic-update experience instead of continuous animation.

**What changes:**

| Element | Motion ON | Reduced motion |
|---|---|---|
| Flow animation bar | 2.4s looping translate | Static gradient underline icon |
| Live status dot | 1.6s opacity pulse | Static filled circle |
| Runway red pulse outline | 2s pulse | Solid vermillion border, no pulse |
| Accrued counter | 60fps continuous tick | Updates every **1.5s** (discrete jump) |
| Flow-rate badge | Continuous | Updates every 1.5s |
| Progress bar segment | Smooth width interpolation | Snaps to new width on each 1.5s tick (200ms ease) |
| Top-up success checkmark | 1.2s fade | Shows immediately, holds 1.5s |
| Top-up error shake | Horizontal shake | Inline error text only, no shake |

**Implementation note:** The reduced-motion cadence (1.5s) is a single source-of-truth constant
`REDUCED_MOTION_TICK_MS = 1500`. When reduced motion is active, the component switches its update
loop from `requestAnimationFrame` to `setInterval(tick, 1500)`. Numeric fields still use
`tabular-nums` and fixed-width containers so even the discrete 1.5s jumps don't jitter.

---

## Edge Cases & State Invariants

| Scenario | Handling |
|---|---|
| **Stream Paused** | Accrued value stops growing; flow-rate badge shows `⏸ Paused`; `Live` dot becomes static grey; progress bar Accrued segment holds its width; runway indicator shows "Paused — no depletion while idle". Top-up pills hidden (channel is paused, not depleted). |
| **Stream Depleted** (accrued = 100% of deposit) | Card header shows `⚠ Depleted`; flow-rate badge reads `0.0000 USDC/min`; progress bar fills completely (Claimed+Accrued = 100%, Remaining = 0); runway indicator shows "Depleted — Top up to resume" in vermillion; top-up pills are emphasized (primary style). |
| **Runway = 0** (imminent exhaustion) | Runway chip solid vermillion with "Depleted — Top up to resume"; a toast/banner suggests an immediate top-up. |
| **Flow rate = 0** but funds remain | Treated as Paused, not Depleted — runway is shown as "Paused" since no depletion is occurring. |
| **Negative or NaN accrued** (API error) | Render `—` in the accrued field and show an inline "Data unavailable" note; do not animate the bar. |
| **Counterparty unresponsive** (mutual close unavailable) | Mutual Close CTA disabled with tooltip "Counterparty signature pending"; Unilateral Close emphasized as the fallback. |
| **Top-up exceeds wallet balance** | Pill shakes (motion on) / inline error (reduced); error text: "Insufficient balance for top-up." |
| **Channel closed** | Card enters a read-only "Closed" state: all live indicators stop, top-up pills hidden, close buttons replaced with "Channel closed at <timestamp>". |
| **Very long runway (> 999h)** | Format as `>999h` to avoid width blowup; still neutral color. |
| **Rapid digit rollover** (0.0099 → 0.0100) | tabular-nums + fixed `min-width` container prevents the decimal point from shifting the label. |

---

## Responsive Layout

| Breakpoint | Card width | Layout adjustments |
|---|---|---|
| Mobile (< 480px) | 100% | Stack flow-rate badge above progress bar; top-up pills wrap to 2 rows; detail comparison sheet stacks vertically (Mutual above Unilateral) |
| Tablet (480–1024px) | 100% | Flow-rate badge inline with progress bar; comparison sheet remains side-by-side but row labels truncate |
| Desktop (> 1024px) | max 640px | Full layout as specified; comparison sheet side-by-side with full row labels |

The progress bar always uses `width: 100%` of its container and never scrolls horizontally;
on very narrow screens the segment labels move below the bar in a 3-column grid.

---

## Accessibility

- Every live numeric field has an `aria-live="polite"` region so screen readers announce
  meaningful changes (accrued value, runway state) without spamming on every animation frame.
  Under reduced motion, announcements align to the 1.5s tick.
- The flow-rate badge container has `role="status"` and an `aria-label` describing the rate
  in words, e.g. `"Streaming at 0.0042 USDC per minute, approximately 2.5 kilowatt-hours per hour."`.
- The progress bar is a real `role="progressbar"` with `aria-valuenow` / `aria-valuemin=0` /
  `aria-valuemax=100` reflecting the Accrued percentage, plus an `aria-label` listing all three
  segment values.
- Runway state chips use `role="img"` with descriptive `aria-label` (color is never the only
  signal — each state has a text label: "Healthy", "amber < 24h", "red < 4h", "Depleted").
- Top-up pills are real `<button>` elements with `aria-label` like "Top up 10 USDC".
- The comparison sheet table uses semantic `<th scope="col">` headers and a `<caption>`.
- Minimum 4.5:1 contrast for all text; the amber runway chip uses a dark text color
  (`#5A4400`) over the yellow background to meet AA.
- All animations are gated behind `prefers-reduced-motion` (see
  [Reduced-Motion Alternative](#reduced-motion-alternative)).

---

## Verification Checklist

- [ ] Streaming card eliminates horizontal numeric jitter — every live counter uses
  `tabular-nums` + monospace stack + fixed `min-width` container + right alignment.
- [ ] Flow animation indicator renders as a static icon under `prefers-reduced-motion: reduce`.
- [ ] Reduced-motion alternative provides clean periodic (1.5s) numeric updates with no
  continuous animation.
- [ ] Runway indicator transitions neutral (> 72h) → amber (< 24h) → red (< 4h) with a smooth
  400ms color crossfade and text labels (not color-only encoding).
- [ ] Quick top-up micro-interaction (+10, +50, Custom) fully specified with focus rings,
  confirm popover, success checkmark, and error states.
- [ ] Dual-segment progress bar shows Claimed | Accrued (Claimable Now) | Remaining Buffer
  with segment labels in tabular-nums outside the bar.
- [ ] "Stream Paused / Depleted" state clearly shown when accrued = 100% of deposited funds.
- [ ] Mutual Close vs. Unilateral Dispute Close comparison sheet explains instant settlement
  vs. challenge-window delay with aligned rows and differentiated CTAs.
- [ ] Counterparty-unresponsive case disables Mutual Close with a clear tooltip and emphasizes
  Unilateral Close.
- [ ] Responsive layout verified at 320px, 480px, 768px, 1280px, 1920px.
- [ ] All live regions use `aria-live="polite"`; progress bar uses `role="progressbar"`.
- [ ] Minimum 4.5:1 text contrast across all runway states (amber chip uses dark text).
