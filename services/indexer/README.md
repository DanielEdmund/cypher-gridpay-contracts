# Event Indexer Service

The Cypher GridPay Event Indexer continuously streams onchain events from Soroban RPC and updates read-model projection tables.

## Configuration

- `SOROBAN_RPC_URL` — Stellar Soroban RPC endpoint
- `DATABASE_URL` — PostgreSQL connection string
- `START_LEDGER` — Initial sync ledger sequence (defaults to contract deployment ledger)
- `BATCH_SIZE` — Number of ledgers processed per poll iteration (default: 50)

## Commands

```bash
# Start event indexer in follow mode
npm run start:indexer

# Replay events from specific ledger
npm run reindex -- --from-ledger 123456
```
