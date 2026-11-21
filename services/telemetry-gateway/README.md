# Smart Meter Ingestion Gateway

High-throughput, cryptographically verified ingestion gateway for GridPay IoT smart meters.

## Ingestion Protocol

- `POST /v1/telemetry/submit` — Hardware meters push signed 15-minute consumption packets.
- `GET /v1/meters/:meterId/status` — Query meter registration, active tariff tier, and last synchronized nonce.
- `POST /v1/meters/batch/flush` — Manually trigger batch usage reporting to `PaymentContract::report_usage`.
