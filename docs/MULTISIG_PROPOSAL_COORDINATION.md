# Multi-Sig Proposal Coordination & XDR Inspection Runbook

Runbook for inspecting, validating, and cosigning proposals in `orchestrator/contracts/admin`.

## Workflow

1. **Proposal Detection**: Ingestion worker captures `AdminContract` proposal events.
2. **XDR Decompilation**: Decodes arguments into human-readable JSON diffs.
3. **Cosigner Alerting**: Dispatches notifications with direct approval links.
4. **Execution Monitoring**: Validates that timelock delay has elapsed before triggering `execute_upgrade`.
