# Merchant Analytics & Refund Anomaly Data Visualization Specification

**Issue:** [#420](https://github.com/johnephraim949-web/cypher-gridpay-contracts/issues/420)  
**Status:** Draft  
**Last Updated:** 2026-11-21

---

## Table of Contents

1. [Overview](#overview)
2. [Color-Blind Safe Palette](#color-blind-safe-palette)
3. [Series-to-Style Mapping](#series-to-style-mapping)
4. [Chart Component Standards](#chart-component-standards)
   - [Tooltip Specification](#tooltip-specification)
   - [Threshold Reference Lines](#threshold-reference-lines)
   - [Chart / Table View Switcher](#chart--table-view-switcher)
5. [ReasonCodeChart Specification](#reasoncodechart-specification)
6. [QuotaGauge Specification](#quotagauge-specification)
7. [Edge Cases & Resilience](#edge-cases--resilience)
8. [Responsive Layout](#responsive-layout)
9. [Accessibility](#accessibility)
10. [Verification Checklist](#verification-checklist)

---

## Overview

This spec defines standardized chart primitives for merchant-facing analytics covering:

- **Refund reason-code velocity** (`get_reason_code_velocity_delta`) — time-series line chart with up to 6 simultaneous series.
- **Quota / Chargeback Ratio gauges** — radial or bar gauges with Warning and Circuit Breaker Trip bands.

All charts share a single color system, tooltip pattern, threshold-line pattern, and Chart/Table toggle so the UI is internally consistent and comprehensible under deuteranopia, protanopia, and tritanopia conditions.

---

## Color-Blind Safe Palette

The palette is derived from the **Okabe-Ito** scheme, which is verified safe under all three major color-vision deficiencies. Each color is paired with a distinct line-dash pattern and a crosshatch fill pattern so series are distinguishable by shape alone when printed in greyscale or viewed under any CVD simulation.

| Token | Hex | RGB | Dash Pattern | Fill Hatch | Series Label |
|---|---|---|---|---|---|
| `--cb-blue` | `#0072B2` | 0, 114, 178 | solid `—` | none | ProductDefect |
| `--cb-vermillion` | `#D55E00` | 213, 94, 0 | dashed `– –` | diagonal `/` | NonDelivery |
| `--cb-sky` | `#56B4E9` | 86, 180, 233 | dotted `· · ·` | cross `+` | DuplicateCharge |
| `--cb-green` | `#009E73` | 0, 158, 115 | dash-dot `-·-` | horizontal `—` | Unauthorized |
| `--cb-yellow` | `#F0E442` | 240, 228, 66 | long-dash `——` | vertical `\|` | CustomerRequest |
| `--cb-orange` | `#E69F00` | 230, 159, 0 | dot-dot-dash `··–` | dots `·` | Other |

> **Simulation verification:** Run each color individually through [Coblis](https://www.color-blindness.com/coblis-color-blindness-simulator/) and [Stark](https://www.getstark.co/) for Deuteranopia (green-blind), Protanopia (red-blind), and Tritanopia (blue-blind) before shipping. All six tokens must remain visually distinct in every simulation.

### CSS Custom Properties

```css
:root {
  /* Okabe-Ito color-blind safe palette */
  --cb-blue:      #0072B2;
  --cb-vermillion:#D55E00;
  --cb-sky:       #56B4E9;
  --cb-green:     #009E73;
  --cb-yellow:    #F0E442;
  --cb-orange:    #E69F00;

  /* Semantic chart tokens */
  --chart-threshold-warning:       #F0E442; /* cb-yellow */
  --chart-threshold-circuit-break: #D55E00; /* cb-vermillion */
  --chart-threshold-band-warning-bg:       rgba(240, 228,  66, 0.12);
  --chart-threshold-band-circuit-break-bg: rgba(213,  94,   0, 0.12);

  --chart-grid-line:   rgba(0,0,0,0.08);
  --chart-axis-label:  #5A6478;
  --chart-tooltip-bg:  #1C2333;
  --chart-tooltip-fg:  #F4F6FA;
  --chart-empty-fg:    #8A93A6;
}
```

---

## Series-to-Style Mapping

```ts
// shared/chartPalette.ts
export const REASON_CODE_SERIES = [
  {
    key: 'ProductDefect',
    color: 'var(--cb-blue)',
    dash: [],           // solid
    hatch: 'none',
  },
  {
    key: 'NonDelivery',
    color: 'var(--cb-vermillion)',
    dash: [6, 3],       // dashed
    hatch: 'diagonal',
  },
  {
    key: 'DuplicateCharge',
    color: 'var(--cb-sky)',
    dash: [2, 3],       // dotted
    hatch: 'cross',
  },
  {
    key: 'Unauthorized',
    color: 'var(--cb-green)',
    dash: [6, 3, 2, 3], // dash-dot
    hatch: 'horizontal',
  },
  {
    key: 'CustomerRequest',
    color: 'var(--cb-yellow)',
    dash: [10, 4],      // long-dash
    hatch: 'vertical',
  },
  {
    key: 'Other',
    color: 'var(--cb-orange)',
    dash: [2, 2, 6, 2], // dot-dot-dash
    hatch: 'dots',
  },
] as const;

export type ReasonCodeKey = typeof REASON_CODE_SERIES[number]['key'];
```

---

## Chart Component Standards

### Tooltip Specification

Every chart tooltip follows this structure:

```
┌─────────────────────────────────────────────┐
│  2026-09-14  •  Epoch 47                    │
├─────────────────────────────────────────────┤
│  ● ProductDefect      1,284   ▲ +18.4%      │
│  ╌ NonDelivery          392   ▼ −3.1%       │
│  · DuplicateCharge       57   ▲ +2.0%       │
│  ─· Unauthorized         29   — 0.0%        │
│  —— CustomerRequest      14   ▼ −8.7%       │
│  ·· Other               208   ▲ +41.2%      │
└─────────────────────────────────────────────┘
```

**Rules:**
- Numbers use `font-variant-numeric: tabular-nums` so columns align.
- Dates are displayed as `YYYY-MM-DD  •  Epoch N` where N is the sequential epoch index.
- Delta badges: `▲` for positive delta (color `--cb-green`), `▼` for negative (color `--cb-vermillion`), `—` for zero (color `--cb-axis-label`). Delta is computed vs. the previous epoch for the same series.
- The tooltip follows the cursor and flips horizontally when the cursor is within 220 px of the right viewport edge, and flips vertically when within 160 px of the bottom edge.
- On touch/mobile, the tooltip pins to the top of the chart card instead of following the touch point.

### Threshold Reference Lines

Used on **QuotaGauge** and any time-series chart that tracks a capped ratio.

| Band | Label | Value | Line Style | Background Fill |
|---|---|---|---|---|
| Warning | "Warning (75%)" | 0.75 | dashed `– –`, `--chart-threshold-warning` | `--chart-threshold-band-warning-bg` |
| Circuit Breaker | "Circuit Breaker Trip (100%)" | 1.00 | solid, `--chart-threshold-circuit-break` | `--chart-threshold-band-circuit-break-bg` |

The colored fill covers the area **above** the Warning threshold up to the Circuit Breaker line, and the area above the Circuit Breaker line uses the circuit-break color at higher opacity.

Labels sit at the right edge of the chart, right-aligned, in `12px` semibold, never occluded by chart data.

### Chart / Table View Switcher

Every analytics card includes a segmented toggle in its header:

```
[ Chart | Table ]
```

- Keyboard: `Tab` focuses the toggle group; `←` / `→` arrows switch modes. Active mode has `aria-pressed="true"`.
- Screen reader: `role="group"` on the wrapper, `aria-label="View as chart or table"` on the toggle group.
- **Table view** renders a `<table>` with `scope="col"` headers, `tabular-nums` cells, and a visible caption matching the chart title. All series values and computed deltas are present.
- The active view preference is persisted to `localStorage` under key `analytics.viewMode.<chartId>`.

---

## ReasonCodeChart Specification

**File:** `apps/web/src/components/analytics/ReasonCodeChart.tsx`

### Purpose

Displays refund reason-code velocity over time (daily/weekly epochs). Calls `get_reason_code_velocity_delta` to derive per-epoch deltas and renders up to 6 series simultaneously.

### Props

```ts
interface ReasonCodeChartProps {
  /** Array of epoch data points */
  data: EpochDataPoint[];
  /** Epoch granularity shown on the x-axis */
  granularity?: 'daily' | 'weekly';
  /** Enable logarithmic y-axis scale toggle */
  allowLogScale?: boolean;
  /** Override which series are visible on initial render */
  defaultVisibleSeries?: ReasonCodeKey[];
  /** Chart card identifier – used for localStorage view mode key */
  chartId: string;
}

interface EpochDataPoint {
  epochIndex: number;
  date: string; // ISO 8601
  ProductDefect: number;
  NonDelivery: number;
  DuplicateCharge: number;
  Unauthorized: number;
  CustomerRequest: number;
  Other: number;
}
```

### Layout

```
┌─────────────────────────────────────────────────────┐
│ Refund Reason-Code Velocity          [ Chart|Table ] │
│ ─────────────────────────────────────────────────── │
│                                                     │
│  2,000 ┤                                            │
│  1,500 ┤      ╱╲                                   │
│  1,000 ┤_____/  ╲___                               │
│    500 ┤                ╲__                        │
│      0 ┼────┬────┬────┬────┬────                  │
│        Sep1 Sep8 Sep15 Sep22 Sep29                 │
│                                                     │
│  ● ProductDefect  ╌ NonDelivery  · DuplicateCharge  │
│  ─· Unauthorized  —— CustomerRequest  ·· Other      │
│                                     [Log Scale ☐]   │
└─────────────────────────────────────────────────────┘
```

### Behavior

- **Empty state:** When `data` is empty or all series values are zero, render a centered illustration with label "No refund data for this period." Legend items are still shown but greyed out.
- **Sparse epochs:** Missing values for a series on a given epoch are treated as `null` and rendered as a gap in the line (not interpolated to zero).
- **Outlier / Log Scale:** When `allowLogScale` is `true`, a checkbox "Log Scale" appears below the legend. Toggling it switches the y-axis between linear and `log10`. Zero and null values are excluded from log scale calculation to prevent `-Infinity`.
- **Series toggle:** Clicking a legend item toggles that series off/on. Hidden series are excluded from tooltip rendering. At least one series must remain visible (the last visible series cannot be toggled off).
- **Zoom:** Brush selection on the x-axis zooms the visible range. A "Reset zoom" button appears when zoomed.

---

## QuotaGauge Specification

**File:** `apps/web/src/components/analytics/QuotaGauge.tsx`

### Purpose

Renders a horizontal bar gauge for a single ratio metric (e.g., Chargeback Ratio, Refund Quota Utilization). Shows Warning and Circuit Breaker thresholds.

### Props

```ts
interface QuotaGaugeProps {
  /** Gauge label shown as heading */
  label: string;
  /** Current ratio value, 0–1 (or beyond 1 if circuit breaker is tripped) */
  value: number;
  /** Previous epoch value for delta badge */
  previousValue?: number;
  /** Warning threshold, default 0.75 */
  warningThreshold?: number;
  /** Circuit breaker threshold, default 1.0 */
  circuitBreakerThreshold?: number;
  /** Chart card identifier */
  chartId: string;
}
```

### Layout

```
┌──────────────────────────────────────────────────────┐
│ Chargeback Ratio                      [ Chart|Table ] │
│ ──────────────────────────────────────────────────── │
│                                                      │
│   62.3%   ▲ +4.1% vs prev epoch                     │
│                                                      │
│  ████████████████████░░░░░░░░│░░░░░░░░░│            │
│  0%                        75%       100%            │
│                          Warning  Circuit Breaker    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Behavior

- **Fill color** transitions by range:
  - `0–warningThreshold`: `--cb-blue`
  - `warningThreshold–circuitBreakerThreshold`: `--cb-yellow`
  - Above `circuitBreakerThreshold`: `--cb-vermillion`
- The bar fill animates from 0 to `value` on mount (300 ms ease-out) and re-animates on value change.
- **Empty / zero state:** Shows "No data available" in `--chart-empty-fg` with a fully empty bar.
- **Overflow:** If `value > circuitBreakerThreshold`, the bar fills to 100% and a "⚠ Circuit Breaker Tripped" badge appears below the bar in `--cb-vermillion`.
- **Table view:** Shows a two-row table: current value (formatted as `XX.X%`) and delta vs previous epoch.
- **Tooltip (hover/focus):** Shows exact numeric value, threshold distances: "12.7% below Warning", "37.7% below Circuit Breaker Trip".

---

## Edge Cases & Resilience

| Scenario | Handling |
|---|---|
| Zero-volume day for all series | Render flat line at 0, do not collapse chart; show epoch on x-axis |
| Zero-volume for one series only | Render flat line at 0 for that series; tooltip shows `0` with `—` delta |
| Single epoch in dataset | Render a point (dot) instead of a line; x-axis shows only that date |
| Extreme outlier spike (1 series >> others) | On linear scale, smaller series compress. Toggle "Log Scale" to restore readability. Consider showing a note: "Outlier detected – consider enabling log scale." when any single value is > 10× the median. |
| All series hidden | Prevent hiding the last visible series; show toast "At least one series must be visible." |
| Tooltip near viewport edge | Flip horizontally at right edge (< 220 px clearance), vertically at bottom (< 160 px clearance) |
| Narrow mobile screen (< 400 px) | Tooltip pins to top of card; legend wraps to 2-column grid; x-axis labels skip alternate ticks |
| `get_reason_code_velocity_delta` returns error | Show inline error state: "Could not load velocity data. Retry ↺" with retry button |
| NaN / null values in API response | Treat as missing (`null`); render as gap in line, exclude from delta calculation |

---

## Responsive Layout

| Breakpoint | Chart Height | Legend Layout | X-axis Tick Density |
|---|---|---|---|
| Mobile (< 480 px) | 220 px | 2-column grid | Every 2nd epoch |
| Tablet (480–1024 px) | 300 px | Single row wrapping | Every epoch |
| Desktop (> 1024 px) | 360 px | Single row | Every epoch |

Charts use `width: 100%` and respond to container resize via `ResizeObserver`. Minimum chart width is 280 px; below this, a horizontal scroll container wraps the chart.

---

## Accessibility

- All SVG charts include `role="img"` and `aria-label` with a plain-language description of the chart content (e.g., `"Line chart showing refund reason-code velocity from 2026-09-01 to 2026-09-30. ProductDefect is the highest series, peaking at 1,284 on 2026-09-14."`).
- Interactive chart regions (data points, gauge fill) are focusable via `Tab` and announce values via `aria-live="polite"` on focus change.
- Color is never the **only** encoding: every series uses both color and dash/hatch pattern.
- All threshold lines include a visible text label — not just a colored line.
- Minimum contrast ratio of 4.5:1 against chart background for all labels and axis text (WCAG 2.1 AA).
- Chart / Table toggle fulfills the "text alternative" requirement: users who cannot interpret the chart can switch to the table view at any time.

---

## Verification Checklist

- [ ] Color palette passes Coblis/Stark simulation for Deuteranopia, Protanopia, and Tritanopia for all 6 series simultaneously.
- [ ] Every chart includes threshold reference lines (Warning 75%, Circuit Breaker Trip 100%) with visible text labels.
- [ ] Empty/zero-volume states render without layout collapse.
- [ ] Single-epoch datasets render a point, not an empty chart.
- [ ] Outlier spike (>10× median) triggers log-scale recommendation note.
- [ ] Tooltip flips correctly at right and bottom viewport edges.
- [ ] Tooltip pins to card top on mobile (< 480 px).
- [ ] Chart / Table switcher works via keyboard (`←`/`→`) and is announced by screen reader.
- [ ] Table view includes all series values and computed deltas with correct `scope` headers.
- [ ] `localStorage` persistence of view mode works across page reload.
- [ ] Log-scale toggle excludes zero/null values from calculation.
- [ ] `get_reason_code_velocity_delta` error state shows retry UI.
- [ ] Responsive layout verified at 320 px, 480 px, 768 px, 1280 px, 1920 px viewport widths.
- [ ] All SVG elements have `role="img"` and descriptive `aria-label`.
- [ ] Minimum 4.5:1 contrast ratio for all text elements.
