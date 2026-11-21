# Architecture

This document describes the high-level architecture of the Handoff protocol: the on-chain Soroban contracts, the off-chain orchestrator, and how they interact.

## Overview

Handoff is composed of two layers:

- **On-chain contracts** (`core/contracts/*`, `orchestrator/contracts/admin`) — Soroban smart contracts that hold funds, enforce escrow/refund/payment rules, and gate privileged admin operations.
- **Off-chain services** (`orchestrator/*`) — indexers, API servers, and keepers that observe ledger state, drive migrations, and restore archived entries.

## Contracts

| Contract | Path | Responsibility |
| --- | --- | --- |
| Payment | `core/contracts/payment` | Records and settles payments between parties. |
| Escrow | `core/contracts/escrow` | Holds funds in escrow until release/refund conditions are met. |
| Refund | `core/contracts/refund` | Handles refund flows and reconciliation. |
| Admin | `orchestrator/contracts/admin` | Privileged configuration, schema versioning, and migration entrypoints. |

Each contract owns its own storage namespace and schema version. Storage keys, tiers, and TTL behavior are catalogued in [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md).

## Storage Model

Soroban exposes three storage tiers:

- **Instance** — a single entry per contract, capped at 64 KB, loaded with every invocation. Use only for small, bounded, contract-wide state (config, schema version, counters).
- **Persistent** — durable per-key entries that survive archival only if their TTL is extended. Use for user records, balances, and anything that must not silently disappear.
- **Temporary** — cheap per-key entries that are expected to expire. Use for caches, nonces, and short-lived locks.

> **Warning:** never place unbounded maps or user-keyed records in `Instance` storage. The 64 KB instance limit is shared by the entire contract and will eventually brick writes.

See [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md) for the full key inventory and the chunked migration runbook, and [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md) for the archival restoration decision matrix.

## Schema Versioning & Migrations

Schema changes are versioned and applied in bounded chunks so that no single transaction exceeds ledger resource limits:

1. `dry_run_migrate_schema` — simulate the next batch without mutating state.
2. `migrate_schema_step` — apply one bounded batch of migrations.
3. `get_migration_cursor` — read the current cursor to resume or verify progress.

The exact workflow, CLI examples, and per-batch ledger budget are documented in [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md).

## State Archival

Persistent entries expire when their TTL lapses and must be restored before they can be read or written. Restoration can be automated via the SDK `restorePreamble` for simple cases, or performed manually by a keeper/admin for complex or bulk recoveries. The decision matrix and verification steps (including `verify_archived_record_inclusion`) live in [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md).

## Operational Runbook

Day-to-day operations — deployments, incident response, migration execution, and archival recovery — are covered in [OPERATIONAL_RUNBOOK.md](./OPERATIONAL_RUNBOOK.md).

## Related Documentation

- [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md) — storage key inventory, tiers, TTL triggers, and chunked migration runbook.
- [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md) — archival restoration decision matrix and verification.
- [OPERATIONAL_RUNBOOK.md](./OPERATIONAL_RUNBOOK.md) — operational procedures and incident response.
