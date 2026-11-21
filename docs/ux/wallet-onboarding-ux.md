# Wallet Onboarding & First-Time Stellar User Education — UX Specification

**Issue:** #421  
**Status:** Draft  
**Affected component:** `apps/web/src/components/wallet/WalletSelectorModal.tsx`

---

## 1. Overview

New users arriving at a Cypher GridPay checkout or customer portal from traditional payment rails (credit card, bank transfer, PayPal) frequently have no prior experience with Stellar-specific concepts. When they encounter terms like "trustline", "minimum reserve", or "wrong network" without context, they abandon the flow immediately.

This specification defines:

1. A **Wallet Selector Modal** that offers the clearest first path to both crypto-native users and mainstream buyers.
2. Three **Just-In-Time (JIT) micro-educator cards** that appear only when a specific blocker is detected — never on page load, never speculatively.

The guiding principle throughout is **progressive disclosure**: show only what the user needs to unblock the next step, with an optional "Learn more" escape hatch for those who want depth.

---

## 2. Wallet Selector Modal

### 2.1 Trigger

The modal opens **only** on an explicit user action (clicking "Connect Wallet", "Pay with Crypto", or "Sign In"). It is never auto-triggered on page load. This avoids browser popup-blocking and establishes trust through user agency.

### 2.2 Layout

```
┌──────────────────────────────────────────────┐
│  Connect your wallet                    [×]  │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  ⭐ Continue with Passkey            │   │  ← featured, full-width
│  │     Face ID · Touch ID · PIN         │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  — or choose a wallet ——————————————————    │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Freighter│ │  xBull   │ │  Albedo  │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐                               │
│  │  Lobstr  │                               │
│  └──────────┘                               │
│                                              │
│  ▸ New to Stellar? (30-second explainer)    │
└──────────────────────────────────────────────┘
```

On **mobile** (< 640 px) the wallet grid stacks to a single column. The Passkey option remains full-width at the top. The modal renders as a bottom sheet with a drag handle on mobile.

On **desktop** the modal is a centered overlay (max-width 440 px) with a backdrop.

### 2.3 Wallet Options

#### Featured — Passkey (mainstream-first)

Displayed as a prominent full-width card above the divider. Labelled with familiar biometric cues the user already knows from their phone or laptop:

> **Continue with Passkey**  
> Sign in securely using Face ID, Touch ID, or your device PIN. No seed phrase needed.

The sub-label adapts to the detected platform:
- iOS/macOS: "Face ID or Touch ID"
- Android: "Fingerprint or face unlock"
- Windows: "Windows Hello"
- Fallback: "Your device biometrics"

Clicking this option initiates the Passkey smart-wallet creation/sign-in flow. It never opens an external browser extension popup.

#### Wallet Grid

A 3-column grid (desktop) / 1-column list (mobile) of extension/app wallets:

| Wallet | Type | Notes |
|--------|------|-------|
| Freighter | Browser extension | Most common for desktop power users |
| xBull | Browser extension + mobile | Cross-platform |
| Albedo | Web-based | No install required — good second option for mainstream users |
| Lobstr | Mobile app | Popular for mobile-first users |

Each wallet tile shows:
- Logo (32 × 32 px, rounded)
- Wallet name (14 px, weight 600)
- Short descriptor (12 px, muted): e.g. "Browser extension", "Mobile app", "No install"
- If the wallet extension is **not detected**, show a subtle "Install" badge and open the wallet's download page on click rather than attempting to connect.

### 2.4 "New to Stellar?" Expandable Explainer

A chevron-toggle row at the bottom of the modal. Closed by default to avoid overwhelming new users; present to signal that help is available.

**Closed state:**  
`▸ New to Stellar?`

**Expanded state (30-second visual explainer):**

```
┌──────────────────────────────────────────────┐
│  Stellar is a payment network — like a         │
│  global bank wire, but instant and free.       │
│                                                │
│  Your wallet is like a bank account that       │
│  only you control. No passwords to forget:     │
│  your device biometrics are the key.           │
│                                                │
│  USDC on Stellar is the same US dollar-        │
│  backed stablecoin you may already know —      │
│  just traveling on a faster network.           │
│                                                │
│  [Learn more about Stellar →]                  │
└──────────────────────────────────────────────┘
```

Copy rules:
- No unexplained acronyms: never use SAC, XDR, SEP-41, or similar in this section.
- Two sentences maximum per concept.
- Link opens `https://stellar.org/learn` in a new tab.

---

## 3. JIT Micro-Educator Cards

Each card appears inline — directly above or below the action it relates to — and is triggered only when the specific blocker condition is detected. Cards are never shown speculatively.

### 3.1 Missing Trustline

**Trigger condition:** The user's wallet account does not have a USDC trustline established.

**Placement:** Inline, above the "Pay" or "Confirm" button on the checkout screen.

**Visual design:**

```
┌─────────────────────────────────────────────────────────┐
│  💡  Enable USDC in your wallet                         │
│                                                         │
│  To hold and send USDC payments, your wallet needs a    │
│  one-time setup step called enabling USDC. It takes     │
│  one click and sets aside 0.5 XLM as a small deposit —  │
│  which remains yours and can be recovered if you ever   │
│  close the USDC balance.                                │
│                                                         │
│  [Enable USDC — 1 click]          [Learn more →]       │
└─────────────────────────────────────────────────────────┘
```

**Copy rules:**
- Never use the word "trustline" in the primary copy. Use "enable USDC" instead.
- State the XLM cost (0.5 XLM) and immediately reassure the user it is recoverable.
- Primary CTA triggers the trustline-add transaction; secondary CTA opens docs in a new tab.

**Approved copy (≤ 2 sentences):**
> To hold and send USDC payments, your wallet needs a one-time "enable USDC" step. It takes one click and sets aside 0.5 XLM as a small deposit — which stays yours and can be recovered later.

### 3.2 Low XLM Reserve

**Trigger condition:** The user's spendable XLM balance is below the amount needed to cover the Stellar minimum account reserve plus transaction fees.

**Placement:** Inline, above the "Pay" or "Confirm" button.

**Visual design:**

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  Your XLM balance is a little low                   │
│                                                         │
│  Stellar accounts keep a small portion of XLM locked    │
│  as a security deposit (currently ~1–2 XLM). This isn't │
│  a fee — it's your money, just reserved to keep your    │
│  account open. Your spendable balance is what's left    │
│  after this reserve.                                    │
│                                                         │
│  You need approximately [X] XLM more to proceed.        │
│                                                         │
│  [Add XLM to my wallet]           [Learn more →]       │
└─────────────────────────────────────────────────────────┘
```

**Dynamic values:**
- `[X]` = computed shortfall, rounded up to 2 decimal places.
- "currently ~1–2 XLM" updates to the actual current base reserve fetched from Horizon.

**Approved copy (≤ 2 sentences):**
> Stellar accounts keep a small amount of XLM locked as a security deposit — it's your money, just held to keep your account open. You need approximately [X] XLM more to cover this reserve before proceeding.

**Copy rules:**
- Never say "fee" for the reserve — it is not a fee.
- Never say "insufficient funds" — say "a little low" or "just below the required amount".

### 3.3 Wrong Network

**Trigger condition:** The connected wallet is on Testnet but the application expects Mainnet (or vice versa).

**Placement:** Inline, replacing the action button area entirely (the payment cannot proceed on the wrong network).

**Visual design:**

```
┌─────────────────────────────────────────────────────────┐
│  🔀  Your wallet is on a different network               │
│                                                         │
│  This app runs on Stellar Mainnet (the live network).   │
│  Your wallet appears to be connected to Testnet         │
│  (a practice environment). Payments made on Testnet     │
│  do not use real funds and won't be received here.      │
│                                                         │
│  How to switch to Mainnet:                              │
│                                                         │
│  Freighter:  Settings → Network → Public Network        │
│  xBull:      ⚙ → Network → Mainnet                     │
│  Albedo:     Reconnect — Mainnet is the default         │
│                                                         │
│  [I've switched — reconnect]      [Learn more →]       │
└─────────────────────────────────────────────────────────┘
```

**Visual diagram (inline SVG or image):**

```
Testnet  ──✕──►  Mainnet
  [Practice]      [Live]
```

A small two-node diagram makes the concept visual without requiring text to explain "network".

**Approved copy (≤ 2 sentences):**
> This checkout uses the live Stellar network, but your wallet is connected to the practice environment. Switch to Mainnet in your wallet settings, then reconnect.

**Copy rules:**
- Never say "wrong network" to the user — say "different network".
- Provide wallet-specific step-by-step instructions for every supported wallet.
- The "I've switched — reconnect" CTA re-runs the wallet connection check.

---

## 4. Light and Dark Mode Tokens

### Wallet Selector Modal

| Element | Light | Dark |
|---------|-------|------|
| Modal background | `#FFFFFF` | `#1F2937` |
| Backdrop | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.6)` |
| Border | `#E5E7EB` | `#374151` |
| Passkey button bg | `#1D4ED8` | `#2563EB` |
| Passkey button text | `#FFFFFF` | `#FFFFFF` |
| Wallet tile bg | `#F9FAFB` | `#111827` |
| Wallet tile border | `#E5E7EB` | `#374151` |
| Wallet tile hover bg | `#EFF6FF` | `#1E3A8A` |
| Primary text | `#111827` | `#F9FAFB` |
| Muted text | `#6B7280` | `#9CA3AF` |
| Divider | `#E5E7EB` | `#374151` |

### JIT Card — Missing Trustline

| Element | Light | Dark |
|---------|-------|------|
| Card bg | `#EFF6FF` | `#172554` |
| Left border accent | `#3B82F6` | `#60A5FA` |
| Icon color | `#2563EB` | `#93C5FD` |
| Text | `#1E3A8A` | `#DBEAFE` |
| CTA button | `#2563EB` | `#3B82F6` |

### JIT Card — Low XLM Reserve

| Element | Light | Dark |
|---------|-------|------|
| Card bg | `#FEFCE8` | `#422006` |
| Left border accent | `#EAB308` | `#FDE047` |
| Icon color | `#CA8A04` | `#FEF08A` |
| Text | `#713F12` | `#FEF9C3` |
| CTA button | `#D97706` | `#F59E0B` |

### JIT Card — Wrong Network

| Element | Light | Dark |
|---------|-------|------|
| Card bg | `#FFF7ED` | `#431407` |
| Left border accent | `#F97316` | `#FB923C` |
| Icon color | `#EA580C` | `#FDBA74` |
| Text | `#7C2D12` | `#FFEDD5` |
| CTA button | `#EA580C` | `#F97316` |

---

## 5. Desktop vs. Mobile Behavior

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Modal style | Centered overlay, max-width 440 px | Bottom sheet with drag handle |
| Wallet grid | 3-column | Single column list |
| Passkey label | "Face ID, Touch ID, or Windows Hello" | "Face ID, Touch ID, or fingerprint" |
| Extension wallets | Show extension wallets first | Show mobile-compatible wallets first (xBull, Lobstr); extension wallets marked "Desktop only" |
| JIT cards | Rendered inline in content flow | Rendered as sticky bottom cards that appear above the keyboard |
| Explainer expand | Smooth height animation | Smooth height animation |

---

## 6. Accessibility

- The modal has `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing to the title heading.
- On open, focus moves to the first focusable element (Passkey button).
- On close, focus returns to the trigger element.
- Focus is trapped inside the modal while it is open (Tab / Shift+Tab cycle only within).
- The backdrop click and `Escape` key both close the modal.
- JIT cards use `role="status"` and `aria-live="polite"` so screen readers announce them when they appear without interrupting the user.
- The "New to Stellar?" toggle has `aria-expanded` and `aria-controls`.
- Color is never the sole differentiator — each JIT card has a distinct icon and title text.
- All interactive elements have a visible focus ring (`:focus-visible` outline).

---

## 7. Copy Rules Summary

| Rule | Detail |
|------|--------|
| No raw acronyms | SAC, XDR, SEP-41, SEP-10, XLM as a ticker without explanation are forbidden in user-facing copy |
| XLM always explained | First use: "XLM (Stellar's native currency)" or describe the amount in USD equivalent if available |
| Reserve ≠ fee | Never call the Stellar minimum reserve a "fee" — it is a "deposit" or "reserve" that remains the user's money |
| Trustline → "enable [token]" | Use "Enable USDC" rather than "add trustline" |
| Network names | "Live network" / "Mainnet" for production; "Practice environment" / "Testnet" for test |
| Tone | Calm, instructional, non-technical. Treat the user as intelligent but new to this specific technology. |
| Sentence limit | JIT micro-educator primary copy: ≤ 2 sentences. "Learn more" links available for depth. |

---

## 8. Acceptance Criteria

- [ ] Wallet selector modal designed for Light and Dark modes, desktop and mobile, covering Passkey (featured), Freighter, xBull, Albedo, Lobstr.
- [ ] "New to Stellar?" expandable explainer present, with zero unexplained Stellar acronyms.
- [ ] All 3 JIT micro-educator cards (Missing Trustline, Low XLM Reserve, Wrong Network) designed for Light and Dark modes.
- [ ] Copy reviewed: no SAC, XDR, SEP-41, XDR, or other unexplained Stellar acronyms in any user-visible string.
- [ ] Wallet modal never auto-triggers on page load — requires explicit user click.
- [ ] Desktop browser extension and mobile wallet browser flows both handled without code path divergence.
- [ ] All modal and card interactive elements are keyboard-accessible with visible focus rings and proper ARIA attributes.
