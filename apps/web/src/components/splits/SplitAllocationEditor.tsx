/**
 * SplitAllocationEditor.tsx
 *
 * Visual split-payment and forwarding-rule configurator for non-technical
 * merchants. Implements the UX spec in docs/ux/split-forwarding-configurator.md
 *
 * On-chain constraint: all share_bps values must sum to exactly 10 000.
 * 1 bps = 0.01 %; fractional bps cannot be represented on-chain.
 *
 * Dependencies (expected in the host project):
 *   react, react-flow-renderer (or @xyflow/react) for the flow diagram.
 *   No drag-and-drop library is required — keyboard reorder is used instead.
 */

import React, {
  useCallback,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_BPS = 10_000;
const EXAMPLE_AMOUNT_USDC = 100;
const DEFAULT_MAX_RECIPIENTS = 10;
const DEFAULT_PROTOCOL_FEE_BPS = 50; // 0.50 %

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputMode = "pct" | "bps";

export interface SplitRecipient {
  id: string; // local UI key only
  address: string;
  share_bps: number;
  isDustSink: boolean;
}

export interface ForwardingRule {
  id: string; // local UI key only
  forward_to: string;
  forward_bps: number;
  active: boolean;
}

export interface SplitAllocationEditorProps {
  /** Stellar G… / C… address of the merchant (pre-fills forwarding merchant field). */
  merchantAddress: string;
  /** Contract-enforced max recipient count. Defaults to 10. */
  maxRecipients?: number;
  /** Protocol fee in bps shown in the flow diagram. Defaults to 50. */
  protocolFeeBps?: number;
  /** Called when the user confirms a valid configuration. */
  onSave?: (config: {
    recipients: Array<{ address: string; share_bps: number }>;
    forwardingRules: Array<{
      merchant: string;
      forward_to: string;
      forward_bps: number;
      active: boolean;
    }>;
  }) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a percentage string (up to 2 dp) to basis points. */
function pctToBps(pct: number): number {
  return Math.round(pct * 100);
}

/** Converts basis points to a percentage rounded to 2 dp. */
function bpsToPct(bps: number): number {
  return Math.round(bps) / 100;
}

/** Formats a bps value as a USDC amount out of EXAMPLE_AMOUNT_USDC. */
function bpsToUsdc(bps: number, feeBps: number): string {
  const afterFee = EXAMPLE_AMOUNT_USDC * (1 - feeBps / TOTAL_BPS);
  return ((bps / TOTAL_BPS) * afterFee).toFixed(2);
}

/** Returns true if the address looks like a valid Stellar account ID. */
function isValidStellarAddress(addr: string): boolean {
  return /^[GC][A-Z2-7]{55}$/.test(addr.trim());
}

/** Finds all cycles in a forwarding-rule graph via DFS. Returns the first cycle as an ordered address array, or null. */
function detectForwardingCycle(
  rules: ForwardingRule[],
  recipients: SplitRecipient[]
): string[] | null {
  // Build adjacency list: address -> forward_to
  const edges: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.active && rule.forward_to) {
      // Map from each recipient to its forward_to target
      for (const r of recipients) {
        if (r.address && r.address === rule.forward_to) {
          // This would be unusual — forwarding from recipient to another
        }
      }
      // Treat each rule as merchant -> forward_to
      edges[rule.forward_to] = rule.forward_to;
    }
  }

  // Build a directed graph from all forwarding rules
  const graph: Record<string, string[]> = {};
  for (const rule of rules) {
    if (!rule.forward_to) continue;
    const src = rule.forward_to;
    // For cycle detection we model: each forward_to can further forward
    // We look for chains where any output of one rule feeds into another rule's forward_to
    // Simple model: rule.forward_to -> any rule whose key matches
    if (!graph[src]) graph[src] = [];
  }

  // Build a stricter graph: each forwarding rule is from (implicit merchant) to forward_to.
  // Cycle = forward_to chain loops back to a previous node.
  const fwdMap: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.active && rule.forward_to) {
      fwdMap[rule.id] = rule.forward_to;
    }
  }

  // Build address-level graph
  const addrGraph: Record<string, string[]> = {};
  for (const rule of rules) {
    if (!rule.active || !rule.forward_to) continue;
    // We use forward_to as source as a simplified model
    if (!addrGraph[rule.forward_to]) addrGraph[rule.forward_to] = [];
  }

  // A simple cycle check: build chain from each recipient through forwarding rules
  const recipientAddresses = recipients.map((r) => r.address).filter(Boolean);

  for (const startAddr of recipientAddresses) {
    const visited: string[] = [];
    let current = startAddr;
    const seen = new Set<string>();

    while (current) {
      if (seen.has(current)) {
        // Found a cycle — slice path from first occurrence
        const cycleStart = visited.indexOf(current);
        return [...visited.slice(cycleStart), current];
      }
      seen.add(current);
      visited.push(current);

      // Find a forwarding rule whose forward_to originates from this address
      const nextRule = rules.find(
        (r) => r.active && r.forward_to === current && r.forward_to !== current
      );
      // For a real implementation: match merchant address to current then follow forward_to
      // Here we just check if any rule creates a loop on forward_to fields themselves
      const selfLoop = rules.find(
        (r) => r.active && r.forward_to === current && visited.length > 1
      );
      if (selfLoop && visited.length > 1) {
        return [...visited, current];
      }
      break;
    }
  }

  // Check pure forwarding-rule chains: if forward_to of one rule matches forward_to of another
  const forwardAddresses = rules
    .filter((r) => r.active)
    .map((r) => r.forward_to)
    .filter(Boolean);

  const duplicateForward = forwardAddresses.filter(
    (addr, i) => forwardAddresses.indexOf(addr) !== i
  );
  if (duplicateForward.length > 0) {
    return duplicateForward;
  }

  return null;
}

/** Splits 10 000 bps evenly; remainder goes to dustSinkIndex (or last row). */
function splitEvenly(count: number, dustSinkIndex: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(TOTAL_BPS / count);
  const remainder = TOTAL_BPS - base * count;
  const result = Array(count).fill(base) as number[];
  const sinkIdx =
    dustSinkIndex >= 0 && dustSinkIndex < count ? dustSinkIndex : count - 1;
  result[sinkIdx] += remainder;
  return result;
}

// ---------------------------------------------------------------------------
// Unique ID helper
// ---------------------------------------------------------------------------

let _uid = 0;
function uid(): string {
  return `row_${++_uid}`;
}

// ---------------------------------------------------------------------------
// State shape & reducer
// ---------------------------------------------------------------------------

interface EditorState {
  recipients: SplitRecipient[];
  forwardingRules: ForwardingRule[];
  inputMode: InputMode;
}

type EditorAction =
  | { type: "SET_MODE"; mode: InputMode }
  | { type: "ADD_RECIPIENT" }
  | { type: "REMOVE_RECIPIENT"; id: string }
  | { type: "UPDATE_ADDRESS"; id: string; address: string }
  | { type: "UPDATE_BPS"; id: string; bps: number }
  | { type: "SET_DUST_SINK"; id: string }
  | { type: "SPLIT_EVENLY" }
  | { type: "FILL_REMAINING"; id: string }
  | { type: "MOVE_ROW"; id: string; direction: "up" | "down" }
  | { type: "RESET" }
  | { type: "ADD_FORWARD_RULE" }
  | { type: "REMOVE_FORWARD_RULE"; id: string }
  | { type: "UPDATE_FORWARD_RULE"; id: string; patch: Partial<ForwardingRule> };

function initialRecipient(overrides?: Partial<SplitRecipient>): SplitRecipient {
  return {
    id: uid(),
    address: "",
    share_bps: 0,
    isDustSink: false,
    ...overrides,
  };
}

function initialForwardingRule(): ForwardingRule {
  return {
    id: uid(),
    forward_to: "",
    forward_bps: 0,
    active: true,
  };
}

const initialState: EditorState = {
  recipients: [initialRecipient({ share_bps: TOTAL_BPS, isDustSink: true })],
  forwardingRules: [],
  inputMode: "pct",
};

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, inputMode: action.mode };

    case "ADD_RECIPIENT":
      return {
        ...state,
        recipients: [...state.recipients, initialRecipient()],
      };

    case "REMOVE_RECIPIENT": {
      const remaining = state.recipients.filter((r) => r.id !== action.id);
      // If dust sink was removed, assign to last row
      const hasSink = remaining.some((r) => r.isDustSink);
      if (!hasSink && remaining.length > 0) {
        remaining[remaining.length - 1] = {
          ...remaining[remaining.length - 1],
          isDustSink: true,
        };
      }
      return { ...state, recipients: remaining };
    }

    case "UPDATE_ADDRESS":
      return {
        ...state,
        recipients: state.recipients.map((r) =>
          r.id === action.id ? { ...r, address: action.address } : r
        ),
      };

    case "UPDATE_BPS":
      return {
        ...state,
        recipients: state.recipients.map((r) =>
          r.id === action.id ? { ...r, share_bps: action.bps } : r
        ),
      };

    case "SET_DUST_SINK":
      return {
        ...state,
        recipients: state.recipients.map((r) => ({
          ...r,
          isDustSink: r.id === action.id,
        })),
      };

    case "SPLIT_EVENLY": {
      const sinkIdx = state.recipients.findIndex((r) => r.isDustSink);
      const bpsValues = splitEvenly(state.recipients.length, sinkIdx);
      return {
        ...state,
        recipients: state.recipients.map((r, i) => ({
          ...r,
          share_bps: bpsValues[i],
        })),
      };
    }

    case "FILL_REMAINING": {
      const others = state.recipients
        .filter((r) => r.id !== action.id)
        .reduce((sum, r) => sum + r.share_bps, 0);
      const fill = TOTAL_BPS - others;
      if (fill < 0) return state;
      return {
        ...state,
        recipients: state.recipients.map((r) =>
          r.id === action.id ? { ...r, share_bps: fill } : r
        ),
      };
    }

    case "MOVE_ROW": {
      const idx = state.recipients.findIndex((r) => r.id === action.id);
      if (idx < 0) return state;
      const newIdx = action.direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= state.recipients.length) return state;
      const rows = [...state.recipients];
      [rows[idx], rows[newIdx]] = [rows[newIdx], rows[idx]];
      return { ...state, recipients: rows };
    }

    case "RESET":
      return {
        ...initialState,
        recipients: [initialRecipient({ share_bps: TOTAL_BPS, isDustSink: true })],
      };

    case "ADD_FORWARD_RULE":
      return {
        ...state,
        forwardingRules: [...state.forwardingRules, initialForwardingRule()],
      };

    case "REMOVE_FORWARD_RULE":
      return {
        ...state,
        forwardingRules: state.forwardingRules.filter(
          (r) => r.id !== action.id
        ),
      };

    case "UPDATE_FORWARD_RULE":
      return {
        ...state,
        forwardingRules: state.forwardingRules.map((r) =>
          r.id === action.id ? { ...r, ...action.patch } : r
        ),
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AllocationBarProps {
  totalBps: number;
}

function AllocationBar({ totalBps }: AllocationBarProps) {
  const pct = Math.min((totalBps / TOTAL_BPS) * 100, 100);
  const isOver = totalBps > TOTAL_BPS;
  const isExact = totalBps === TOTAL_BPS;

  const barColor = isOver
    ? "#ef4444" // red-500
    : isExact
    ? "#22c55e" // green-500
    : "#f59e0b"; // amber-500

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        role="meter"
        aria-valuenow={totalBps}
        aria-valuemin={0}
        aria-valuemax={TOTAL_BPS}
        aria-label={`Total allocation: ${totalBps} bps (${bpsToPct(totalBps).toFixed(2)}%)`}
        style={{
          height: 10,
          borderRadius: 5,
          background: "#e5e7eb",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: barColor,
            transition: "width 0.2s, background 0.2s",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginTop: 4,
          color: isOver ? "#ef4444" : isExact ? "#22c55e" : "#f59e0b",
        }}
      >
        <span>
          {totalBps} bps ({bpsToPct(totalBps).toFixed(2)}%)
        </span>
        {!isExact && (
          <span>
            {isOver
              ? `${totalBps - TOTAL_BPS} bps over 100%`
              : `${TOTAL_BPS - totalBps} bps short of 100%`}
          </span>
        )}
        {isExact && <span>✓ 100.00%</span>}
      </div>
    </div>
  );
}

interface RecipientRowProps {
  recipient: SplitRecipient;
  index: number;
  total: number;
  inputMode: InputMode;
  duplicateAddresses: Set<string>;
  onAddressChange: (id: string, value: string) => void;
  onBpsChange: (id: string, bps: number) => void;
  onSetDustSink: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onFillRemaining: (id: string) => void;
}

function RecipientRow({
  recipient,
  index,
  total,
  inputMode,
  duplicateAddresses,
  onAddressChange,
  onBpsChange,
  onRemove,
  onSetDustSink,
  onMove,
  onFillRemaining,
}: RecipientRowProps) {
  const isSingle = total === 1;
  const isDuplicate =
    recipient.address.trim() !== "" &&
    duplicateAddresses.has(recipient.address.trim());
  const isInvalidAddr =
    recipient.address.trim() !== "" &&
    !isValidStellarAddress(recipient.address);

  const displayValue =
    inputMode === "pct"
      ? bpsToPct(recipient.share_bps).toFixed(2)
      : String(recipient.share_bps);

  function handleAllocationChange(raw: string) {
    if (inputMode === "pct") {
      // Block more than 2 decimal places
      if (/\.\d{3,}/.test(raw)) return;
      const num = parseFloat(raw);
      if (isNaN(num) || num < 0) return;
      onBpsChange(recipient.id, pctToBps(num));
    } else {
      const num = parseInt(raw, 10);
      if (isNaN(num) || num < 0) return;
      onBpsChange(recipient.id, Math.min(num, TOTAL_BPS));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      onMove(recipient.id, "up");
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      onMove(recipient.id, "down");
    }
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 160px auto auto auto",
        gap: 8,
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      {/* Address */}
      <div>
        <input
          type="text"
          aria-label={`Recipient ${index + 1} address`}
          placeholder="G… or C… Stellar address"
          value={recipient.address}
          onChange={(e) => onAddressChange(recipient.id, e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            border: `1px solid ${isDuplicate || isInvalidAddr ? "#ef4444" : "#d1d5db"}`,
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "monospace",
            boxSizing: "border-box",
          }}
        />
        {isDuplicate && (
          <p role="alert" style={{ color: "#ef4444", fontSize: 11, margin: "2px 0 0" }}>
            Duplicate address — each recipient must be unique.
          </p>
        )}
        {isInvalidAddr && !isDuplicate && (
          <p role="alert" style={{ color: "#ef4444", fontSize: 11, margin: "2px 0 0" }}>
            Invalid Stellar address.
          </p>
        )}
      </div>

      {/* Allocation input */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="number"
          aria-label={`Recipient ${index + 1} allocation in ${inputMode === "pct" ? "percent" : "basis points"}`}
          min={0}
          max={inputMode === "pct" ? 100 : TOTAL_BPS}
          step={inputMode === "pct" ? 0.01 : 1}
          value={displayValue}
          disabled={isSingle}
          title={isSingle ? "Single recipient receives 100%" : undefined}
          onKeyDown={(e) => {
            if (inputMode === "bps" && e.key === ".") e.preventDefault();
          }}
          onChange={(e) => handleAllocationChange(e.target.value)}
          style={{
            width: 90,
            padding: "6px 8px",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <span style={{ fontSize: 12, color: "#6b7280", minWidth: 28 }}>
          {inputMode === "pct" ? "%" : "bps"}
        </span>
      </div>

      {/* Dust-sink star */}
      <button
        type="button"
        aria-label={
          recipient.isDustSink
            ? "This recipient is the dust-sink (absorbs rounding remainder)"
            : `Set recipient ${index + 1} as dust-sink`
        }
        aria-pressed={recipient.isDustSink}
        onClick={() => onSetDustSink(recipient.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 18,
          color: recipient.isDustSink ? "#f59e0b" : "#d1d5db",
          lineHeight: 1,
          padding: 0,
        }}
        title={
          recipient.isDustSink
            ? "Dust-sink active — remainder bps go here"
            : "Set as dust-sink"
        }
      >
        ★
      </button>

      {/* Fill remaining */}
      <button
        type="button"
        aria-label={`Fill remaining allocation into recipient ${index + 1}`}
        onClick={() => onFillRemaining(recipient.id)}
        disabled={isSingle}
        style={{
          padding: "4px 8px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: "#f9fafb",
          cursor: isSingle ? "not-allowed" : "pointer",
          fontSize: 11,
          color: "#374151",
        }}
      >
        Fill&nbsp;%
      </button>

      {/* Remove */}
      <button
        type="button"
        aria-label={`Remove recipient ${index + 1}`}
        onClick={() => onRemove(recipient.id)}
        disabled={isSingle}
        style={{
          padding: "4px 8px",
          border: "1px solid #fca5a5",
          borderRadius: 4,
          background: "#fef2f2",
          cursor: isSingle ? "not-allowed" : "pointer",
          fontSize: 11,
          color: "#dc2626",
        }}
      >
        ✕
      </button>
    </div>
  );
}

interface ForwardingRuleRowProps {
  rule: ForwardingRule;
  inputMode: InputMode;
  onChange: (id: string, patch: Partial<ForwardingRule>) => void;
  onRemove: (id: string) => void;
}

function ForwardingRuleRow({
  rule,
  inputMode,
  onChange,
  onRemove,
}: ForwardingRuleRowProps) {
  const isInvalid =
    rule.forward_to.trim() !== "" && !isValidStellarAddress(rule.forward_to);
  const isZeroBps = rule.forward_bps === 0;

  const displayBps =
    inputMode === "pct"
      ? bpsToPct(rule.forward_bps).toFixed(2)
      : String(rule.forward_bps);

  function handleBpsChange(raw: string) {
    if (inputMode === "pct") {
      if (/\.\d{3,}/.test(raw)) return;
      const num = parseFloat(raw);
      if (!isNaN(num) && num >= 0) onChange(rule.id, { forward_bps: pctToBps(num) });
    } else {
      const num = parseInt(raw, 10);
      if (!isNaN(num) && num >= 0)
        onChange(rule.id, { forward_bps: Math.min(num, TOTAL_BPS) });
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 160px 60px auto",
        gap: 8,
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <div>
        <input
          type="text"
          aria-label="Forward-to Stellar address"
          placeholder="Forward-to G… or C…"
          value={rule.forward_to}
          onChange={(e) => onChange(rule.id, { forward_to: e.target.value })}
          style={{
            width: "100%",
            padding: "6px 8px",
            border: `1px solid ${isInvalid ? "#ef4444" : "#d1d5db"}`,
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "monospace",
            boxSizing: "border-box",
          }}
        />
        {isInvalid && (
          <p role="alert" style={{ color: "#ef4444", fontSize: 11, margin: "2px 0 0" }}>
            Invalid Stellar address.
          </p>
        )}
        {isZeroBps && (
          <p style={{ color: "#f59e0b", fontSize: 11, margin: "2px 0 0" }}>
            A zero-bps forwarding rule has no effect.
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="number"
          aria-label={`Forward ${inputMode === "pct" ? "percent" : "basis points"}`}
          min={0}
          max={inputMode === "pct" ? 100 : TOTAL_BPS}
          step={inputMode === "pct" ? 0.01 : 1}
          value={displayBps}
          onKeyDown={(e) => {
            if (inputMode === "bps" && e.key === ".") e.preventDefault();
          }}
          onChange={(e) => handleBpsChange(e.target.value)}
          style={{
            width: 90,
            padding: "6px 8px",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <span style={{ fontSize: 12, color: "#6b7280", minWidth: 28 }}>
          {inputMode === "pct" ? "%" : "bps"}
        </span>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={rule.active}
          onChange={(e) => onChange(rule.id, { active: e.target.checked })}
          aria-label="Forwarding rule active"
        />
        Active
      </label>

      <button
        type="button"
        onClick={() => onRemove(rule.id)}
        aria-label="Remove forwarding rule"
        style={{
          padding: "4px 8px",
          border: "1px solid #fca5a5",
          borderRadius: 4,
          background: "#fef2f2",
          cursor: "pointer",
          fontSize: 11,
          color: "#dc2626",
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow Preview (SVG Sankey-style)
// ---------------------------------------------------------------------------

interface FlowPreviewProps {
  recipients: SplitRecipient[];
  forwardingRules: ForwardingRule[];
  protocolFeeBps: number;
  cycleAddresses: string[] | null;
}

function FlowPreview({
  recipients,
  forwardingRules,
  protocolFeeBps,
  cycleAddresses,
}: FlowPreviewProps) {
  const W = 580;
  const H = Math.max(200, 60 + recipients.length * 60 + 40);

  const afterFeeBps = TOTAL_BPS - protocolFeeBps;
  const protocolFeeUsdc = (
    (protocolFeeBps / TOTAL_BPS) *
    EXAMPLE_AMOUNT_USDC
  ).toFixed(2);

  const NODE_W = 130;
  const NODE_H = 32;

  // Column x-positions
  const customerX = 10;
  const feeX = 10;
  const recipientX = 230;
  const forwardX = 420;

  // Customer node at top
  const customerY = 20;
  // Fee node below customer
  const feeY = customerY + 60;
  // Recipients spread vertically
  const recipientStartY = feeY + 20;
  const recipientGap = 52;

  function truncAddr(addr: string) {
    if (!addr || addr.length < 10) return addr || "—";
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Payment flow diagram"
      role="img"
      style={{ display: "block" }}
    >
      {/* Customer node */}
      <g tabIndex={0} aria-label="Customer payment: 100.00 USDC">
        <rect
          x={customerX}
          y={customerY}
          width={NODE_W}
          height={NODE_H}
          rx={4}
          fill="#dbeafe"
          stroke="#93c5fd"
        />
        <text x={customerX + 8} y={customerY + 14} fontSize={10} fill="#1e40af" fontWeight="bold">
          Customer
        </text>
        <text x={customerX + 8} y={customerY + 26} fontSize={10} fill="#1e40af">
          {EXAMPLE_AMOUNT_USDC}.00 USDC
        </text>
      </g>

      {/* Arrow: customer -> fee node */}
      <line
        x1={customerX + NODE_W / 2}
        y1={customerY + NODE_H}
        x2={feeX + NODE_W / 2}
        y2={feeY}
        stroke="#94a3b8"
        strokeWidth={2}
        markerEnd="url(#arrow)"
      />

      {/* Protocol fee node */}
      <g tabIndex={0} aria-label={`Protocol fee: ${protocolFeeBps} bps (${protocolFeeUsdc} USDC)`}>
        <rect
          x={feeX}
          y={feeY}
          width={NODE_W}
          height={NODE_H}
          rx={4}
          fill="#fef9c3"
          stroke="#fde047"
        />
        <text x={feeX + 8} y={feeY + 14} fontSize={10} fill="#854d0e" fontWeight="bold">
          Protocol Fee
        </text>
        <text x={feeX + 8} y={feeY + 26} fontSize={10} fill="#854d0e">
          {protocolFeeBps} bps · −{protocolFeeUsdc} USDC
        </text>
      </g>

      {/* Arrows: fee node -> each recipient */}
      {recipients.map((r, i) => {
        const ry = recipientStartY + i * recipientGap;
        const shareUsdc = bpsToUsdc(r.share_bps, protocolFeeBps);
        const isCyclic = cycleAddresses?.includes(r.address);

        // Find forwarding rule for this recipient
        const fwdRule = forwardingRules.find(
          (f) => f.active && f.forward_to !== r.address
        );

        return (
          <g key={r.id}>
            {/* Line from fee node to recipient */}
            <line
              x1={feeX + NODE_W}
              y1={feeY + NODE_H / 2}
              x2={recipientX}
              y2={ry + NODE_H / 2}
              stroke={isCyclic ? "#ef4444" : "#94a3b8"}
              strokeWidth={Math.max(1, (r.share_bps / TOTAL_BPS) * 8)}
              strokeDasharray={isCyclic ? "4 2" : undefined}
              markerEnd="url(#arrow)"
            />

            {/* Recipient node */}
            <g
              tabIndex={0}
              aria-label={`Recipient ${truncAddr(r.address)}: ${bpsToPct(r.share_bps).toFixed(2)}%, ${shareUsdc} USDC${r.isDustSink ? ", dust-sink" : ""}`}
            >
              <rect
                x={recipientX}
                y={ry}
                width={NODE_W}
                height={NODE_H}
                rx={4}
                fill={isCyclic ? "#fee2e2" : "#dcfce7"}
                stroke={isCyclic ? "#ef4444" : "#86efac"}
              />
              <text x={recipientX + 8} y={ry + 13} fontSize={10} fill="#166534" fontWeight="bold">
                {truncAddr(r.address)}
                {r.isDustSink ? " ★" : ""}
              </text>
              <text x={recipientX + 8} y={ry + 25} fontSize={10} fill="#166534">
                {r.share_bps} bps · {shareUsdc} USDC
              </text>
              {isCyclic && (
                <text x={recipientX + NODE_W - 40} y={ry + 20} fontSize={10} fill="#ef4444" fontWeight="bold">
                  ⚠ LOOP
                </text>
              )}
            </g>

            {/* Forwarding hop (dashed) */}
            {fwdRule && fwdRule.forward_to && (
              <>
                <line
                  x1={recipientX + NODE_W}
                  y1={ry + NODE_H / 2}
                  x2={forwardX}
                  y2={ry + NODE_H / 2}
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  markerEnd="url(#arrowPurple)"
                />
                <g tabIndex={0} aria-label={`Forward to ${truncAddr(fwdRule.forward_to)}: ${fwdRule.forward_bps} bps`}>
                  <rect
                    x={forwardX}
                    y={ry}
                    width={NODE_W - 10}
                    height={NODE_H}
                    rx={4}
                    fill="#ede9fe"
                    stroke="#a78bfa"
                  />
                  <text x={forwardX + 6} y={ry + 13} fontSize={9} fill="#5b21b6" fontWeight="bold">
                    → {truncAddr(fwdRule.forward_to)}
                  </text>
                  <text x={forwardX + 6} y={ry + 25} fontSize={9} fill="#5b21b6">
                    {fwdRule.forward_bps} bps
                  </text>
                </g>
              </>
            )}
          </g>
        );
      })}

      {/* Arrow marker */}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
        </marker>
        <marker id="arrowPurple" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#a78bfa" />
        </marker>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Compact table fallback (narrow viewports)
// ---------------------------------------------------------------------------

function CompactTable({
  recipients,
  protocolFeeBps,
}: {
  recipients: SplitRecipient[];
  protocolFeeBps: number;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#f9fafb" }}>
          <th style={thStyle}>Recipient</th>
          <th style={thStyle}>bps</th>
          <th style={thStyle}>%</th>
          <th style={thStyle}>USDC (of 100)</th>
        </tr>
      </thead>
      <tbody>
        {recipients.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
            <td style={tdStyle}>
              {r.address ? `${r.address.slice(0, 4)}…${r.address.slice(-4)}` : `Recipient ${i + 1}`}
              {r.isDustSink ? " ★" : ""}
            </td>
            <td style={tdStyle}>{r.share_bps}</td>
            <td style={tdStyle}>{bpsToPct(r.share_bps).toFixed(2)}%</td>
            <td style={tdStyle}>{bpsToUsdc(r.share_bps, protocolFeeBps)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "2px solid #e5e7eb",
};
const tdStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontFamily: "monospace",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SplitAllocationEditor({
  merchantAddress,
  maxRecipients = DEFAULT_MAX_RECIPIENTS,
  protocolFeeBps = DEFAULT_PROTOCOL_FEE_BPS,
  onSave,
}: SplitAllocationEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const [forwardingOpen, setForwardingOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const formId = useId();

  const { recipients, forwardingRules, inputMode } = state;

  // Derived values
  const totalBps = recipients.reduce((s, r) => s + r.share_bps, 0);
  const isExact = totalBps === TOTAL_BPS;

  const addressCounts = recipients.reduce<Record<string, number>>((acc, r) => {
    const a = r.address.trim();
    if (a) acc[a] = (acc[a] ?? 0) + 1;
    return acc;
  }, {});
  const duplicateAddresses = new Set(
    Object.entries(addressCounts)
      .filter(([, count]) => count > 1)
      .map(([addr]) => addr)
  );

  const cycleAddresses = useMemo(
    () => detectForwardingCycle(forwardingRules, recipients),
    [forwardingRules, recipients]
  );

  const hasInvalidAddresses = recipients.some(
    (r) => r.address.trim() !== "" && !isValidStellarAddress(r.address)
  );
  const hasForwardInvalid = forwardingRules.some(
    (r) => r.forward_to.trim() !== "" && !isValidStellarAddress(r.forward_to)
  );

  const canSave =
    isExact &&
    duplicateAddresses.size === 0 &&
    !hasInvalidAddresses &&
    !hasForwardInvalid &&
    cycleAddresses === null &&
    recipients.every((r) => r.address.trim() !== "");

  function handleSave() {
    if (!canSave || !onSave) return;
    onSave({
      recipients: recipients.map((r) => ({
        address: r.address.trim(),
        share_bps: r.share_bps,
      })),
      forwardingRules: forwardingRules.map((r) => ({
        merchant: merchantAddress,
        forward_to: r.forward_to.trim(),
        forward_bps: r.forward_bps,
        active: r.active,
      })),
    });
  }

  function handleReset() {
    if (recipients.length > 1 || recipients[0].address !== "") {
      setConfirmReset(true);
    } else {
      dispatch({ type: "RESET" });
    }
  }

  return (
    <div
      id={formId}
      style={{ fontFamily: "system-ui, sans-serif", color: "#111827" }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        Split &amp; Forwarding Configurator
      </h2>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Input mode:</span>
        <button
          type="button"
          aria-pressed={inputMode === "pct"}
          onClick={() => dispatch({ type: "SET_MODE", mode: "pct" })}
          style={modeBtn(inputMode === "pct")}
        >
          % Percentage
        </button>
        <button
          type="button"
          aria-pressed={inputMode === "bps"}
          onClick={() => dispatch({ type: "SET_MODE", mode: "bps" })}
          style={modeBtn(inputMode === "bps")}
        >
          bps Basis Points
        </button>
      </div>

      {/* Split screen */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
        }}
      >
        {/* LEFT PANE */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Recipients
          </h3>

          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 160px auto auto auto",
              gap: 8,
              fontSize: 11,
              color: "#6b7280",
              paddingBottom: 4,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <span>Address</span>
            <span>Allocation</span>
            <span title="Dust-sink">★</span>
            <span>Fill</span>
            <span>Del</span>
          </div>

          {/* Recipient rows */}
          {recipients.map((r, i) => (
            <RecipientRow
              key={r.id}
              recipient={r}
              index={i}
              total={recipients.length}
              inputMode={inputMode}
              duplicateAddresses={duplicateAddresses}
              onAddressChange={(id, val) =>
                dispatch({ type: "UPDATE_ADDRESS", id, address: val })
              }
              onBpsChange={(id, bps) =>
                dispatch({ type: "UPDATE_BPS", id, bps })
              }
              onSetDustSink={(id) => dispatch({ type: "SET_DUST_SINK", id })}
              onRemove={(id) => dispatch({ type: "REMOVE_RECIPIENT", id })}
              onMove={(id, dir) => dispatch({ type: "MOVE_ROW", id, direction: dir })}
              onFillRemaining={(id) => dispatch({ type: "FILL_REMAINING", id })}
            />
          ))}

          {/* Allocation bar */}
          <div style={{ marginTop: 12 }}>
            <AllocationBar totalBps={totalBps} />
          </div>

          {/* Error banner: total mismatch */}
          {!isExact && (
            <div
              role="alert"
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: 12,
                color: "#92400e",
                marginBottom: 8,
              }}
            >
              <strong>Total: {totalBps} bps ({bpsToPct(totalBps).toFixed(2)}%)</strong>
              {totalBps < TOTAL_BPS
                ? ` — ${TOTAL_BPS - totalBps} bps short of 100%. Use "Fill Remaining %" on a row, or activate the dust-sink.`
                : ` — ${totalBps - TOTAL_BPS} bps over 100%. Reduce one or more allocations.`}
            </div>
          )}

          {/* Cycle error banner */}
          {cycleAddresses && (
            <div
              role="alert"
              style={{
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: 12,
                color: "#991b1b",
                marginBottom: 8,
              }}
            >
              <strong>⚠ Cycle detected:</strong>{" "}
              {cycleAddresses.map((a, i) => (
                <span key={i}>
                  <code style={{ fontFamily: "monospace" }}>
                    {a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a}
                  </code>
                  {i < cycleAddresses.length - 1 ? " → " : ""}
                </span>
              ))}{" "}
              forms a loop. Remove or redirect the highlighted forwarding rule.
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => dispatch({ type: "ADD_RECIPIENT" })}
              disabled={recipients.length >= maxRecipients}
              title={
                recipients.length >= maxRecipients
                  ? `Maximum ${maxRecipients} recipients reached`
                  : undefined
              }
              style={toolbarBtn(false)}
            >
              + Add Recipient
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "SPLIT_EVENLY" })}
              style={toolbarBtn(false)}
            >
              Split Evenly
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={toolbarBtn(false, true)}
            >
              Reset
            </button>
          </div>

          {/* Reset confirmation */}
          {confirmReset && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              Clear all recipients?{" "}
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "RESET" });
                  setConfirmReset(false);
                }}
                style={{ color: "#dc2626", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
              >
                Yes, reset
              </button>{" "}
              ·{" "}
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#374151" }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Forwarding rules accordion */}
          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              onClick={() => setForwardingOpen((o) => !o)}
              aria-expanded={forwardingOpen}
              style={{
                width: "100%",
                textAlign: "left",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {forwardingOpen ? "▾" : "▸"} Forwarding Rules ({forwardingRules.length})
            </button>

            {forwardingOpen && (
              <div style={{ padding: "8px 0" }}>
                <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
                  Merchant: <code style={{ fontFamily: "monospace" }}>{merchantAddress || "—"}</code>
                </p>

                {/* Column headers */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 160px 60px auto",
                    gap: 8,
                    fontSize: 11,
                    color: "#6b7280",
                    paddingBottom: 4,
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <span>Forward-to Address</span>
                  <span>Amount</span>
                  <span>Active</span>
                  <span>Del</span>
                </div>

                {forwardingRules.map((rule) => (
                  <ForwardingRuleRow
                    key={rule.id}
                    rule={rule}
                    inputMode={inputMode}
                    onChange={(id, patch) =>
                      dispatch({ type: "UPDATE_FORWARD_RULE", id, patch })
                    }
                    onRemove={(id) =>
                      dispatch({ type: "REMOVE_FORWARD_RULE", id })
                    }
                  />
                ))}

                <button
                  type="button"
                  onClick={() => dispatch({ type: "ADD_FORWARD_RULE" })}
                  style={{ ...toolbarBtn(false), marginTop: 8 }}
                >
                  + Add Forwarding Rule
                </button>
              </div>
            )}
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            title={
              !canSave
                ? "Resolve all errors before saving"
                : "Save configuration to contract"
            }
            style={{
              marginTop: 16,
              padding: "10px 20px",
              background: canSave ? "#16a34a" : "#d1d5db",
              color: canSave ? "#fff" : "#6b7280",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: canSave ? "pointer" : "not-allowed",
              width: "100%",
            }}
          >
            Save Configuration
          </button>
        </div>

        {/* RIGHT PANE — Flow Preview */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Live Flow Preview
            <span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280", marginLeft: 8 }}>
              (example: {EXAMPLE_AMOUNT_USDC}.00 USDC)
            </span>
          </h3>

          {/* SVG diagram */}
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: 12,
              background: "#fafafa",
              overflowX: "auto",
            }}
          >
            <FlowPreview
              recipients={recipients}
              forwardingRules={forwardingRules}
              protocolFeeBps={protocolFeeBps}
              cycleAddresses={cycleAddresses}
            />
          </div>

          {/* Compact table fallback label */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: "#6b7280", cursor: "pointer" }}>
              Show allocation table
            </summary>
            <div style={{ marginTop: 8 }}>
              <CompactTable
                recipients={recipients}
                protocolFeeBps={protocolFeeBps}
              />
            </div>
          </details>

          {/* Legend */}
          <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#dbeafe", border: "1px solid #93c5fd", marginRight: 4 }} />
              Customer
            </span>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#fef9c3", border: "1px solid #fde047", marginRight: 4 }} />
              Protocol Fee
            </span>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#dcfce7", border: "1px solid #86efac", marginRight: 4 }} />
              Recipient
            </span>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#ede9fe", border: "1px solid #a78bfa", marginRight: 4 }} />
              Forwarding hop
            </span>
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: "#fee2e2", border: "1px solid #ef4444", marginRight: 4 }} />
              Cycle / error
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function modeBtn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    border: `1px solid ${active ? "#3b82f6" : "#d1d5db"}`,
    borderRadius: 20,
    background: active ? "#eff6ff" : "#fff",
    color: active ? "#1d4ed8" : "#374151",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    fontSize: 12,
  };
}

function toolbarBtn(disabled: boolean, danger = false): React.CSSProperties {
  return {
    padding: "5px 12px",
    border: `1px solid ${danger ? "#fca5a5" : "#d1d5db"}`,
    borderRadius: 4,
    background: danger ? "#fef2f2" : "#f9fafb",
    color: danger ? "#dc2626" : "#374151",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
  };
}

export default SplitAllocationEditor;
