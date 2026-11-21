# Evidence Storage & Attestation Service

The Evidence Storage Service manages off-chain artifact collection for disputes in Cypher GridPay.

## API Endpoints

- `POST /v1/disputes/:id/evidence/upload-url` — Request presigned upload URL with SHA-256 integrity challenge.
- `POST /v1/disputes/:id/evidence/attest` — Confirm upload, verify hash against IPFS CID, and issue cryptographic attestation.
- `GET /v1/disputes/:id/evidence` — List authorized evidence artifacts for a dispute (filtered by caller public key).
- `GET /v1/disputes/:id/evidence/:evidenceId/download` — Obtain encrypted payload and caller-specific wrapped DEK.
