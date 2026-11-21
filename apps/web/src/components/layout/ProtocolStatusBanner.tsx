/**
 * ProtocolStatusBanner.tsx
 *
 * Global system status banner for Cypher GridPay.
 * Implements the UX spec in docs/ux/system-status-banners.md
 *
 * Renders a prioritized full-width banner for four severity tiers:
 *   1. Critical  — AdminContract::emergency_pause_all active
 *   2. Partial   — Single subsystem paused via pause_target
 *   3. Degraded  — Soroban RPC offline or ledger lag
 *   4. Informational — Scheduled maintenance
 *
 * Only the highest-priority active notice is shown as the main banner.
 * All lower-priority active notices appear in a collapsible drawer below.
 *
 * Usage:
 *   <ProtocolStatusBanner notices={notices} />
 *
 * The caller is responsible for polling the backend and passing updated
 * `notices`. This component manages only drawer state and localStorage
 * dismissal flags for Informational notices.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BannerTier =
  | "critical"
  | "partial"
  | "degraded"
  | "informational";

export type SubSystem = "escrow" | "payments" | "refunds" | "all";

export interface StatusNotice {
  /** Unique per outage/event; stable for its duration. Used as localStorage key. */
  incident_id: string;
  tier: BannerTier;
  /** Which subsystem is affected (critical / partial tiers). */
  subsystem?: SubSystem;
  /** Overrides the default tier title. */
  title_override?: string;
  /** Overrides the default body copy. */
  body_override?: string;
  cta_label?: string;
  cta_url?: string;
  status_page_url?: string;
  /** Unix timestamp when the pause began. */
  paused_since?: number;
  /** Last confirmed Stellar ledger number (degraded tier). */
  last_ledger?: number;
  /** Unix timestamp of last_ledger (degraded tier). */
  last_ledger_at?: number;
  /** Unix timestamp — maintenance start (informational tier). */
  maintenance_start?: number;
  /** Unix timestamp — maintenance end (informational tier). */
  maintenance_end?: number;
}

export interface ProtocolStatusBannerProps {
  notices: StatusNotice[];
  /**
   * Optional callback invoked when the page body padding-top should change
   * (banner height changed). Pass a setter if you manage body offset externally.
   */
  onHeightChange?: (height: number) => void;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const TIER_ORDER: BannerTier[] = [
  "critical",
  "partial",
  "degraded",
  "informational",
];

const DISMISSED_PREFIX = "dismissed_incident_";

function isDismissed(incident_id: string): boolean {
  try {
    return localStorage.getItem(`${DISMISSED_PREFIX}${incident_id}`) === "1";
  } catch {
    return false;
  }
}

function markDismissed(incident_id: string): void {
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${incident_id}`, "1");
  } catch {
    // localStorage unavailable — ignore
  }
}

function formatTimestamp(unix?: number): string {
  if (!unix) return "unknown";
  return new Date(unix * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function subsystemLabel(sub?: SubSystem): string {
  if (!sub || sub === "all") return "All services";
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

// ---------------------------------------------------------------------------
// Default copy per tier
// ---------------------------------------------------------------------------

function defaultTitle(notice: StatusNotice): string {
  if (notice.title_override) return notice.title_override;
  switch (notice.tier) {
    case "critical":
      return "PROTOCOL PAUSED";
    case "partial":
      return `${subsystemLabel(notice.subsystem).toUpperCase()} TEMPORARILY UNAVAILABLE`;
    case "degraded":
      return "NETWORK SYNC DELAYED";
    case "informational":
      return "SCHEDULED MAINTENANCE";
  }
}

function defaultBody(notice: StatusNotice): string {
  if (notice.body_override) return notice.body_override;
  switch (notice.tier) {
    case "critical":
      if (!notice.subsystem || notice.subsystem === "all") {
        return "Payments and payouts are temporarily paused for maintenance. Your funds and pending balances are fully secured on-chain and have not been affected.";
      }
      return `${subsystemLabel(notice.subsystem)} is temporarily paused. All other services are running normally. Your balances are safe and unaffected.`;
    case "partial":
      return `${subsystemLabel(notice.subsystem)} is under a temporary hold while our team completes a safety check. No funds have moved. We'll update this notice as soon as service resumes.`;
    case "degraded":
      return "We're having trouble reaching the Stellar network right now. You can still view your balances, but submitting transactions is temporarily disabled until connectivity is restored.";
    case "informational": {
      const start = notice.maintenance_start
        ? formatTimestamp(notice.maintenance_start)
        : "a scheduled time";
      const end = notice.maintenance_end
        ? formatTimestamp(notice.maintenance_end)
        : "completion";
      return `We'll be performing routine maintenance from ${start} to ${end} UTC. Transaction submission will be briefly paused. All balances remain safe throughout.`;
    }
  }
}

function defaultCtaLabel(notice: StatusNotice): string | undefined {
  if (notice.cta_label) return notice.cta_label;
  switch (notice.tier) {
    case "critical":
    case "partial":
      return notice.status_page_url ? "View status page →" : undefined;
    case "informational":
      return notice.cta_url ? "View maintenance schedule →" : undefined;
    default:
      return undefined;
  }
}

function subLine(notice: StatusNotice): string | null {
  switch (notice.tier) {
    case "critical":
    case "partial":
      return notice.paused_since
        ? `Paused since ${formatTimestamp(notice.paused_since)}`
        : null;
    case "degraded":
      return notice.last_ledger
        ? `Last synced: ledger #${notice.last_ledger}${notice.last_ledger_at ? ` at ${formatTimestamp(notice.last_ledger_at)}` : ""} · Retrying…`
        : "Attempting to reconnect…";
    case "informational":
      return notice.incident_id ? `Ref: ${notice.incident_id}` : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Theme tokens (CSS-in-JS inline styles)
// ---------------------------------------------------------------------------

type ThemeTokens = {
  bg: string;
  border: string;
  iconColor: string;
  textColor: string;
  mutedColor: string;
};

// We detect dark mode via matchMedia for inline-style fallback.
// In a Tailwind/CSS-var project these would be CSS custom properties.
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

const TOKENS: Record<BannerTier, { light: ThemeTokens; dark: ThemeTokens }> = {
  critical: {
    light: {
      bg: "#FEF2F2",
      border: "#EF4444",
      iconColor: "#DC2626",
      textColor: "#7F1D1D",
      mutedColor: "#B91C1C",
    },
    dark: {
      bg: "#450A0A",
      border: "#F87171",
      iconColor: "#FCA5A5",
      textColor: "#FEE2E2",
      mutedColor: "#FECACA",
    },
  },
  partial: {
    light: {
      bg: "#FFF7ED",
      border: "#F97316",
      iconColor: "#EA580C",
      textColor: "#7C2D12",
      mutedColor: "#C2410C",
    },
    dark: {
      bg: "#431407",
      border: "#FB923C",
      iconColor: "#FDBA74",
      textColor: "#FFEDD5",
      mutedColor: "#FED7AA",
    },
  },
  degraded: {
    light: {
      bg: "#FEFCE8",
      border: "#EAB308",
      iconColor: "#CA8A04",
      textColor: "#713F12",
      mutedColor: "#A16207",
    },
    dark: {
      bg: "#422006",
      border: "#FDE047",
      iconColor: "#FEF08A",
      textColor: "#FEF9C3",
      mutedColor: "#FEF08A",
    },
  },
  informational: {
    light: {
      bg: "#EFF6FF",
      border: "#3B82F6",
      iconColor: "#2563EB",
      textColor: "#1E3A8A",
      mutedColor: "#1D4ED8",
    },
    dark: {
      bg: "#172554",
      border: "#60A5FA",
      iconColor: "#93C5FD",
      textColor: "#DBEAFE",
      mutedColor: "#BFDBFE",
    },
  },
};

function tokens(tier: BannerTier, dark: boolean): ThemeTokens {
  return dark ? TOKENS[tier].dark : TOKENS[tier].light;
}

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

function ShieldAlertIcon({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function AlertTriangleIcon({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function WifiOffIcon({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
      <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0122.56 9" />
      <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
      <path d="M8.53 16.11a6 6 0 016.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function CalendarClockIcon({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="16" cy="16" r="3" />
      <line x1="16" y1="14.5" x2="16" y2="16" />
      <line x1="16" y1="16" x2="17" y2="16" />
    </svg>
  );
}

function TierIcon({ tier, color }: { tier: BannerTier; color: string }) {
  switch (tier) {
    case "critical":
      return <ShieldAlertIcon color={color} />;
    case "partial":
      return <AlertTriangleIcon color={color} />;
    case "degraded":
      return <WifiOffIcon color={color} />;
    case "informational":
      return <CalendarClockIcon color={color} />;
  }
}

// ---------------------------------------------------------------------------
// Single banner row (used for both main banner and drawer items)
// ---------------------------------------------------------------------------

interface BannerRowProps {
  notice: StatusNotice;
  dark: boolean;
  isDrawerItem?: boolean;
  onDismiss?: (id: string) => void;
}

function BannerRow({ notice, dark, isDrawerItem = false, onDismiss }: BannerRowProps) {
  const tk = tokens(notice.tier, dark);
  const title = defaultTitle(notice);
  const body = defaultBody(notice);
  const ctaLabel = defaultCtaLabel(notice);
  const ctaUrl = notice.cta_url ?? notice.status_page_url;
  const sl = subLine(notice);

  const isNonDismissible =
    notice.tier === "critical" ||
    notice.tier === "partial" ||
    notice.tier === "degraded";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: isDrawerItem ? "8px 16px" : "10px 16px",
        background: tk.bg,
        borderLeft: `4px solid ${tk.border}`,
        borderBottom: isDrawerItem ? `1px solid ${tk.border}22` : undefined,
      }}
    >
      {/* Icon */}
      <span style={{ paddingTop: 1 }}>
        <TierIcon tier={notice.tier} color={tk.iconColor} />
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            gap: "4px 8px",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: tk.iconColor,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 14,
              color: tk.textColor,
              lineHeight: 1.4,
            }}
          >
            {body}
          </span>
          {ctaLabel && ctaUrl && (
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: tk.iconColor,
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              {ctaLabel}
            </a>
          )}
        </div>
        {sl && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              fontFamily: "monospace",
              color: tk.mutedColor,
            }}
          >
            {sl}
          </div>
        )}
      </div>

      {/* Dismiss button — Informational only */}
      {!isNonDismissible && onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(notice.incident_id)}
          aria-label={`Dismiss ${title.toLowerCase()} notice`}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: tk.mutedColor,
            fontSize: 18,
            lineHeight: 1,
            padding: "0 4px",
            flexShrink: 0,
            alignSelf: "flex-start",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProtocolStatusBanner({
  notices,
  onHeightChange,
}: ProtocolStatusBannerProps) {
  const dark = usePrefersDark();
  const bannerRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Track locally dismissed informational notices
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const n of notices) {
      if (n.tier === "informational" && isDismissed(n.incident_id)) {
        set.add(n.incident_id);
      }
    }
    return set;
  });

  const handleDismiss = useCallback((id: string) => {
    markDismissed(id);
    setDismissed((prev) => new Set([...prev, id]));
  }, []);

  // Filter out dismissed informational notices, then sort by tier priority
  const activeNotices = notices
    .filter((n) => !(n.tier === "informational" && dismissed.has(n.incident_id)))
    .sort(
      (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    );

  // Notify parent of height changes so it can adjust body padding
  useLayoutEffect(() => {
    if (!bannerRef.current || !onHeightChange) return;
    const ro = new ResizeObserver(([entry]) => {
      onHeightChange(entry.contentRect.height);
    });
    ro.observe(bannerRef.current);
    return () => ro.disconnect();
  }, [onHeightChange]);

  // Move focus to the banner heading when a critical/partial notice first appears
  const headingRef = useRef<HTMLHeadingElement>(null);
  const topTierRef = useRef<BannerTier | null>(null);
  useEffect(() => {
    const top = activeNotices[0];
    if (!top) return;
    if (
      (top.tier === "critical" || top.tier === "partial") &&
      topTierRef.current !== top.tier
    ) {
      topTierRef.current = top.tier;
      headingRef.current?.focus();
    }
  }, [activeNotices]);

  if (activeNotices.length === 0) return null;

  const primary = activeNotices[0];
  const secondaryNotices = activeNotices.slice(1);
  const tk = tokens(primary.tier, dark);

  const isAssertive =
    primary.tier === "critical" ||
    primary.tier === "partial" ||
    primary.tier === "degraded";

  const title = defaultTitle(primary);
  const body = defaultBody(primary);
  const ctaLabel = defaultCtaLabel(primary);
  const ctaUrl = primary.cta_url ?? primary.status_page_url;
  const sl = subLine(primary);

  return (
    <div
      ref={bannerRef}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        width: "100%",
      }}
    >
      {/* Primary banner */}
      <section
        role={isAssertive ? "alert" : "status"}
        aria-live={isAssertive ? "assertive" : "polite"}
        aria-atomic="true"
        aria-label={title}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 16px",
          background: tk.bg,
          borderLeft: `4px solid ${tk.border}`,
          borderBottom: `1px solid ${tk.border}44`,
        }}
      >
        {/* Icon */}
        <span style={{ paddingTop: 2 }}>
          <TierIcon tier={primary.tier} color={tk.iconColor} />
        </span>

        {/* Text content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "4px 10px",
            }}
          >
            {/* Visually hidden heading for focus target */}
            <h2
              ref={headingRef}
              tabIndex={-1}
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: tk.iconColor,
                textTransform: "uppercase",
                outline: "none",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: 14,
                color: tk.textColor,
                lineHeight: 1.4,
              }}
            >
              {body}
            </p>

            {ctaLabel && ctaUrl && (
              <a
                href={ctaUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: tk.iconColor,
                  textDecoration: "underline",
                  whiteSpace: "nowrap",
                }}
              >
                {ctaLabel}
              </a>
            )}
          </div>

          {sl && (
            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                fontFamily: "monospace",
                color: tk.mutedColor,
              }}
            >
              {sl}
            </div>
          )}
        </div>

        {/* Right-side controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
            alignSelf: "flex-start",
            paddingTop: 2,
          }}
        >
          {/* Dismiss (Informational only) */}
          {primary.tier === "informational" && (
            <button
              type="button"
              onClick={() => handleDismiss(primary.incident_id)}
              aria-label={`Dismiss ${title.toLowerCase()} notice`}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: tk.mutedColor,
                fontSize: 18,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          )}

          {/* Drawer toggle */}
          {secondaryNotices.length > 0 && (
            <button
              type="button"
              onClick={() => setDrawerOpen((o) => !o)}
              aria-expanded={drawerOpen}
              aria-controls={drawerId}
              style={{
                background: "none",
                border: `1px solid ${tk.border}`,
                borderRadius: 4,
                cursor: "pointer",
                color: tk.iconColor,
                fontSize: 12,
                fontWeight: 500,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {drawerOpen
                ? `▴ Hide notices`
                : `▾ ${secondaryNotices.length} more notice${secondaryNotices.length > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </section>

      {/* Secondary notices drawer */}
      {secondaryNotices.length > 0 && (
        <div
          id={drawerId}
          role="region"
          aria-label="Additional system notices"
          hidden={!drawerOpen}
          style={{
            borderBottom: drawerOpen ? `1px solid ${tk.border}44` : undefined,
          }}
        >
          {secondaryNotices.map((n) => (
            <BannerRow
              key={n.incident_id}
              notice={n}
              dark={dark}
              isDrawerItem
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PausedActionButton
//
// A wrapper that gracefully degrades any action button when a protocol
// condition prevents it. Shows an inline tooltip explaining why.
// ---------------------------------------------------------------------------

export interface PausedActionButtonProps {
  /** The active notices array — same as passed to ProtocolStatusBanner. */
  notices: StatusNotice[];
  /** The subsystem this action belongs to (optional — narrows the check). */
  subsystem?: SubSystem;
  children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>;
}

function pauseReason(
  notices: StatusNotice[],
  subsystem?: SubSystem
): string | null {
  for (const tier of TIER_ORDER) {
    const match = notices.find((n) => {
      if (n.tier !== tier) return false;
      if (tier === "informational") return false; // doesn't block actions
      if (tier === "critical") return true;
      if (tier === "partial") {
        return (
          !subsystem ||
          !n.subsystem ||
          n.subsystem === "all" ||
          n.subsystem === subsystem
        );
      }
      if (tier === "degraded") return true;
      return false;
    });
    if (match) {
      switch (match.tier) {
        case "critical":
          return "Paused during protocol maintenance";
        case "partial":
          return `Temporarily unavailable — ${subsystemLabel(match.subsystem)} is under a safety hold`;
        case "degraded":
          return "Submitting transactions is disabled while we reconnect to the Stellar network";
      }
    }
  }
  return null;
}

export function PausedActionButton({
  notices,
  subsystem,
  children,
}: PausedActionButtonProps) {
  const reason = pauseReason(notices, subsystem);
  const tooltipId = useId();
  const [showTooltip, setShowTooltip] = useState(false);

  if (!reason) return children;

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
    >
      {React.cloneElement(children, {
        disabled: true,
        "aria-disabled": true,
        "aria-describedby": tooltipId,
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
        },
        style: {
          ...(children.props.style ?? {}),
          opacity: 0.4,
          cursor: "not-allowed",
          pointerEvents: "none",
        },
      })}

      {/* Visually hidden description for screen readers */}
      <span
        id={tooltipId}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
        }}
      >
        {reason}
      </span>

      {/* Visible tooltip on hover/focus */}
      {showTooltip && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1f2937",
            color: "#f9fafb",
            fontSize: 12,
            padding: "5px 10px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            zIndex: 10000,
            pointerEvents: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          {reason}
          {/* Caret */}
          <span
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              borderWidth: 5,
              borderStyle: "solid",
              borderColor: "#1f2937 transparent transparent transparent",
            }}
          />
        </span>
      )}
    </span>
  );
}

export default ProtocolStatusBanner;
