# Ledger Reconciliation & Solvency Drift Runbook

The continuous reconciliation worker executes hourly to guarantee solvency across Cypher GridPay smart contracts and off-chain ledger balances.

## Reconciliation Math

$$\text{Solvency Invariant: } \text{Onchain Vault Balance} \ge \sum \text{Customer Prepaid Balances} + \sum \text{Unsettled Merchant Receivables}$$

If the delta $\Delta < 0$, the worker marks `DRIFT_DETECTED` and issues P1 alerts.
