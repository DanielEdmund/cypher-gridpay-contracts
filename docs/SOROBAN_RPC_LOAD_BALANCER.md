# Soroban RPC Load Balancer & Proxy Configuration

The RPC proxy ensures uninterrupted Soroban node connectivity.

## Features

- **Health Checks**: Polls `/health` every 10 seconds across all configured node providers.
- **Circuit Breaker States**: `CLOSED` (healthy), `OPEN` (tripped, diverting traffic), `HALF-OPEN` (probing single requests).
- **Sticky Ledgers**: Ensures read-after-write operations query a node with a ledger sequence $\ge$ the submit transaction ledger.
