# Global System Status Banners — UX Specification

**Issue:** #414  
**Status:** Draft  
**Affected component:** `apps/web/src/components/layout/ProtocolStatusBanner.tsx`

---

## 1. Overview

When `AdminContract::emergency_pause_all` is active, a Refund circuit breaker trips, or Soroban RPC is experiencing ledger lag, users attempting checkouts or payouts need immediate, calm, and transparent communication. This specification defines a prioritized Global Status Banner hierarchy that:

- Tells users exactly what is paused and why.
- Reassures them that escrowed and pending balances remain safely accounted for on-chain.
- Makes clear which read-only actions remain available.
- Never stacks into clutter — at most one full-width global banner is shown at a time, with an expandable drawer for simultaneous secondary notices.

---

## 2. Severity Tiers

Banners are assigned one of four severity tiers, evaluated in descending priority order. Only the highest active tier renders the full-width global banner. Lower-tier active notices appear in a collapsed drawer below it.

| Priority | Tier | Trigger | Dismissible |
|----------|------|---------|-------------|
| 1 | **Critical — Protocol Paused** | `AdminContract::emergency_pause_all` active, or `pause_target` covering all contracts | No — persists until pause is lifted |
| 2 | **Partial — Subsystem Quarantine** | `pause_target` covering a specific subsystem (Escrow, Payment, or Refund only) | No — persists until subsystem resumes |
| 3 | **Degraded — RPC / Read-Only** | Soroban RPC offline or ledger lag > threshold | No — persists until live connectivity resumes |
| 4 | **Informational — Scheduled Maintenance** | Upcoming or in-progress planned downtime | Yes — dismissed per `incident_id`, remembered in `localStorage` |

---

## 3. Visual Design

### 3.1 Layout

The banner renders as a full-width horizontal strip pinned to the top of the viewport, above the main navigation. It does not scroll away.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Icon] [Title]  [Body copy]  [CTA link]            [Expand ▾] [×?]  │
└──────────────────────────────────────────────────────────────────────┘
```

On mobile (< 640 px) the layout stacks vertically:

```
┌────────────────────────────┐
│ [Icon] [Title]             │
│ [Body copy]                │
│ [CTA link]   [Expand ▾]   │
└────────────────────────────┘
```

The dismiss button `[×]` appears only on the Informational tier. Critical, Partial, and Degraded banners omit it; removing one of these banners requires the underlying condition to clear.

### 3.2 Color Tokens

Each tier uses a distinct background, border, icon, and text color in both Light and Dark modes.

#### Light mode

| Tier | Background | Border (left accent) | Icon color | Text color |
|------|-----------|---------------------|------------|------------|
| Critical | `#FEF2F2` | `#EF4444` (red-500) | `#DC2626` | `#7F1D1D` |
| Partial | `#FFF7ED` | `#F97316` (orange-500) | `#EA580C` | `#7C2D12` |
| Degraded | `#FEFCE8` | `#EAB308` (yellow-500) | `#CA8A04` | `#713F12` |
| Informational | `#EFF6FF` | `#3B82F6` (blue-500) | `#2563EB` | `#1E3A8A` |

#### Dark mode

| Tier | Background | Border (left accent) | Icon color | Text color |
|------|-----------|---------------------|------------|------------|
| Critical | `#450A0A` | `#F87171` | `#FCA5A5` | `#FEE2E2` |
| Partial | `#431407` | `#FB923C` | `#FDBA74` | `#FFEDD5` |
| Degraded | `#422006` | `#FDE047` | `#FEF08A` | `#FEF9C3` |
| Informational | `#172554` | `#60A5FA` | `#93C5FD` | `#DBEAFE` |

### 3.3 Icons

| Tier | Icon (SVG / lucide name) | Meaning |
|------|--------------------------|---------|
| Critical | `ShieldAlert` | Full protocol protection active |
| Partial | `AlertTriangle` | Subsystem-level alert |
| Degraded | `WifiOff` | Connectivity issue |
| Informational | `CalendarClock` | Planned event |

### 3.4 Typography

- **Title:** 14 px, font-weight 700, all-caps small label (e.g. `PROTOCOL PAUSED`).
- **Body copy:** 14 px, font-weight 400, sentence case, max two sentences. See §4 for approved copy.
- **CTA link:** 14 px, font-weight 500, underlined, opens in new tab.
- **Timestamp / ledger info:** 12 px, monospace, muted color.

---

## 4. Copy — Approved Banner Text

All copy follows a calm, transparent, non-technical financial tone. Avoid words like "error", "crash", "failure", or "broken". Use "paused", "temporarily unavailable", "completing safely", or "read-only".

### 4.1 Critical — Protocol Paused

**Title:** PROTOCOL PAUSED

**Body (all contracts):**
> Payments and payouts are temporarily paused for maintenance. Your funds and pending balances are fully secured on-chain and have not been affected.

**Body (specific subsystem via `pause_target`):**
> [Subsystem name] is temporarily paused. All other services are running normally. Your balances are safe and unaffected.

**CTA:** View status page →  
**Sub-line:** Paused since [timestamp] · [status page URL]

### 4.2 Partial — Subsystem Quarantine

**Title:** [SUBSYSTEM] TEMPORARILY UNAVAILABLE

**Body:**
> [Subsystem name] is under a temporary hold while our team completes a safety check. No funds have moved. We'll update this notice as soon as service resumes.

**CTA:** Learn more →  
**Sub-line:** Affected: [Escrow / Payments / Refunds] · Since [timestamp]

### 4.3 Degraded — RPC / Read-Only Mode

**Title:** NETWORK SYNC DELAYED

**Body:**
> We're having trouble reaching the Stellar network right now. You can still view your balances, but submitting transactions is temporarily disabled until connectivity is restored.

**CTA:** None (auto-resolves)  
**Sub-line:** Last synced: ledger #[ledger_number] at [timestamp] · Retrying…

### 4.4 Informational — Scheduled Maintenance

**Title:** SCHEDULED MAINTENANCE

**Body:**
> We'll be performing routine maintenance on [date] from [start_time] to [end_time] UTC. Transaction submission will be briefly paused. All balances remain safe throughout.

**CTA:** View maintenance schedule →  
**Sub-line:** [incident_id] · [status page URL]

---

## 5. Banner Stacking & Drawer

When more than one tier is simultaneously active, only the **highest-priority** banner occupies the full-width strip. All lower-priority active notices are listed in a collapsed **secondary notices drawer** directly below the main banner.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🛡 PROTOCOL PAUSED  Payments paused for maintenance…  View status → │
│                                               ▾ 2 more notices       │
├──────────────────────────────────────────────────────────────────────┤  ← collapsed by default
│  ⚠ Refund circuit breaker active · Cooldown ends ~14:32 UTC         │  ← expands on click
│  📅 Scheduled maintenance window: tomorrow 02:00–04:00 UTC  [×]     │
└──────────────────────────────────────────────────────────────────────┘
```

- The drawer expands/collapses via a toggle button (`▾ N more notices` / `▴ Hide notices`).
- Items in the drawer follow the same color scheme as their tier.
- Dismissible notices show `[×]` inside the drawer item.
- The drawer toggle button is keyboard-focusable with `aria-expanded` state.

---

## 6. Graceful Control Degradation

Action buttons that are unavailable due to a pause or degraded state must **not** silently fail. Each affected button follows this pattern:

| State | Button appearance | Tooltip / inline explanation |
|-------|------------------|------------------------------|
| Protocol paused | Visually disabled (`opacity: 0.4`, `cursor: not-allowed`) | "Paused during protocol maintenance" |
| Subsystem paused | Visually disabled | "Temporarily unavailable — [Subsystem] is under a safety hold" |
| RPC degraded | Visually disabled | "Submitting transactions is disabled while we reconnect to the Stellar network" |
| Scheduled maintenance (future) | Active but with warning icon | "Service will be briefly paused on [date]" |

The tooltip/explanation appears on hover and is also accessible via `aria-describedby` pointing to a visually hidden `<span>` for screen readers. Buttons never throw a click error — the `onClick` handler checks status and returns early with no side-effects when disabled by a protocol condition.

---

## 7. Accessibility

- **Critical, Partial, and Degraded** banners use `role="alert"` and `aria-live="assertive"` so that screen readers announce them immediately when they appear.
- **Informational** banners use `role="status"` and `aria-live="polite"` to avoid interrupting the user.
- The dismiss button (Informational only) has `aria-label="Dismiss scheduled maintenance notice"`.
- The drawer toggle has `aria-expanded` and `aria-controls` pointing to the drawer `id`.
- Color is never the sole indicator of tier — the icon, title label, and body text all differ across tiers.
- The banner is a `<section>` with `aria-label` matching the title (e.g. `aria-label="Protocol Paused"`).
- Focus management: when a critical banner appears dynamically, focus moves to the banner's heading so keyboard users are immediately informed.

---

## 8. Dismissal & Persistence

| Tier | Dismissal | Storage |
|------|-----------|---------|
| Critical | Not dismissible | — |
| Partial | Not dismissible | — |
| Degraded | Not dismissible (auto-clears when RPC recovers) | — |
| Informational | Dismissible by user | `localStorage` key `dismissed_incident_<incident_id>` |

On mount the component reads `localStorage` for each active Informational notice and skips rendering it if the user already dismissed it for that `incident_id`. Clearing localStorage (or a new `incident_id`) re-shows the notice.

---

## 9. Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| ≥ 1024 px (desktop) | Single-row banner, CTA and expand toggle right-aligned |
| 640–1023 px (tablet) | Single-row banner, CTA wraps below body copy |
| < 640 px (mobile) | Two-row banner: title + icon on row 1, body + CTA on row 2 |

The banner always occupies full viewport width and never overlaps page content — the page body has a `padding-top` equal to the banner height, recalculated on resize via `ResizeObserver`.

---

## 10. Light / Dark Mode

The component reads the host application's color scheme preference via a CSS custom-property theme or a `data-theme` attribute on `<html>`. All color tokens (§3.2) are expressed as CSS variables so that a single `prefers-color-scheme: dark` media query or class swap applies the dark palette without JavaScript.

```css
/* Example token mapping */
[data-theme="dark"] .psb-critical {
  --psb-bg: #450A0A;
  --psb-border: #F87171;
  --psb-icon: #FCA5A5;
  --psb-text: #FEE2E2;
}
```

---

## 11. Data Contract

The component accepts a `notices` prop — an array of `StatusNotice` objects sourced from a polling endpoint or WebSocket feed:

```ts
interface StatusNotice {
  incident_id: string;          // unique per outage/event; stable for duration
  tier: "critical" | "partial" | "degraded" | "informational";
  subsystem?: "escrow" | "payments" | "refunds" | "all"; // for critical/partial
  title_override?: string;      // replaces default tier title if set
  body_override?: string;       // replaces default body copy if set
  cta_label?: string;
  cta_url?: string;
  status_page_url?: string;
  paused_since?: number;        // Unix timestamp
  last_ledger?: number;         // for degraded tier
  last_ledger_at?: number;      // Unix timestamp
  maintenance_start?: number;   // for informational tier
  maintenance_end?: number;
}
```

The component is stateless with respect to backend data — the caller is responsible for polling and passing updated `notices`. Internally the component manages only drawer open/closed state and localStorage dismissal flags.

---

## 12. Acceptance Criteria

- [ ] All 4 severity tiers designed with distinct visual treatment for Light and Dark modes, across desktop (≥ 1024 px), tablet (640–1023 px), and mobile (< 640 px).
- [ ] Approved copy (§4) used for all tiers — calm, transparent, non-technical financial tone, no words like "error", "crash", or "failure".
- [ ] Screen readers announce Critical, Partial, and Degraded banners immediately via `role="alert"` / `aria-live="assertive"`.
- [ ] At most one full-width global banner visible at a time; simultaneous lower-priority notices accessible via expandable drawer.
- [ ] Critical, Partial, and Degraded banners are non-dismissible; Informational notices are dismissible per `incident_id` using `localStorage`.
- [ ] Disabled action buttons include explicit tooltip/inline explanation rather than silently failing.
- [ ] Component renders correctly with 0, 1, or N simultaneous active notices.
