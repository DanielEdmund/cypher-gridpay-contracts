# Financial Accounting Exports & Arbitrator Reminder Service

This document specifies the accounting audit exports and arbitrator deadline management services for Cypher GridPay.

---

## 1. Verifiable Regulatory Audit Export Service

Enterprise energy cooperatives, utilities, and corporate merchants require periodic accounting exports aligned with international standards:

- **Supported Formats**:
  - **CSV / JSON**: Daily transaction reconciliations and fee breakdowns.
  - **ISO-20022 XML (`camt.053`)**: Standardized bank statement export for ERP accounting integration (SAP, Oracle NetSuite).
- **Cryptographic Provenance**: Each export file includes a SHA-256 manifest hash signed by the GridPay Protocol Auditor key and cross-referenced with on-chain ledger hashes.

---

## 2. Arbitrator Deadline Reminder & Encrypted Reveal-Key Backup Service

Arbitrators selected into a dispute panel (`select_arbitration_panel`) face stake slashing (`slash_arbitrator_stake`) and reputation loss if they miss ruling deadlines:

- **Multi-Channel Reminders**: Automated notifications via Telegram, Discord, Email, and SMS as commit/reveal deadlines approach ($24h, 6h, 1h$ warnings).
- **Zero-Knowledge Key Backup**: Arbitrators can store client-side encrypted reveal secrets with the backup service. If the arbitrator's primary workstation fails, the backup service releases the reveal commitment upon receiving an authenticated challenge proof.
