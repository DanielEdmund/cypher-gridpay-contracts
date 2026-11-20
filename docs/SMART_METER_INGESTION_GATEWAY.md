# Smart Meter Telemetry Ingestion & Batch Billing Gateway

GridPay IoT smart meters generate high-frequency telemetry (every 5–15 minutes across thousands of consumer residences, solar microgrids, and EV charging stations). Directly submitting each raw measurement onchain is cost-prohibitive.

The Smart Meter Telemetry Gateway ingests, cryptographically verifies, aggregates, and periodically flushes batched usage updates to `core/contracts/payment`.

---

## 1. Hardware Signature Verification

Each meter contains an embedded Secure Element storing a hardware Ed25519 private key:

- **Telemetry Frame**:
  ```json
  {
    "meter_id": "MTR-84820-US",
    "customer_address": "GBBD...24KL",
    "period_start": 1700000000,
    "period_end": 1700000900,
    "kwh_delta": 4.25,
    "peak_kw": 8.1,
    "nonce": 4210,
    "signature": "3a8f...b29c"
  }
  ```
- **Gateway Verification**: The gateway checks `ed25519_verify(signature, payload, meter_pubkey)` and ensures `nonce > last_recorded_nonce`.
- **Tamper Rejection**: Any mismatched signature or out-of-order timestamp immediately trips an alert and isolates the meter.

---

## 2. In-Memory Delta Aggregation & Batch Settlement

1. Verified kWh consumption deltas are accumulated in a Redis cluster keyed by `(customer_address, tariff_tier)`.
2. When a configured billing epoch elapses (e.g., hourly or 100 kWh threshold) or upon settlement cut-off:
   - The gateway compiles a merkle tree of all meter readings.
   - Invokes `PaymentContract::report_usage` (`test_metered_billing.rs`) passing aggregated units and merkle root proof.

---

## 3. Continuous Ledger Reconciliation & Solvency Drift Detection

- **Discrepancy Worker**: Compares on-chain token vault reserves against cumulative merchant receivables and customer prepaid balances.
- **Drift Detection**: Any discrepancy exceeding 1 cent triggers an automated circuit breaker and alerts the on-call protocol team.

---

## 4. Deviation-Guarded Oracle Price Feed Aggregator

- Ingests real-time energy price indices (ERCOT, CAISO, Nord Pool) and currency exchange rates.
- **Circuit Breaker**: Updates exceeding 5% deviation within 15 minutes are queued for multi-sig review before contract submission (`refresh_conversion_rate`).
