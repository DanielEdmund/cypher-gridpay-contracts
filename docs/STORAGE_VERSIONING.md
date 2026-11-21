# Storage Schema Versioning

Cypher GridPay Soroban smart contracts (`core/contracts/payment`, `core/contracts/refund`, `core/contracts/escrow`) and the orchestrator contracts (`orchestrator/contracts/admin`) implement an explicit storage schema versioning convention. This allows deployed contracts to track their data storage layout version on-chain and perform state migrations as stored data structures evolve over time.

---

## 📐 How Storage Schema Versions Are Tracked

Every contract tracks its schema version in instance storage under a dedicated storage key (`ConfigKey::SchemaVersion`, `SystemKey::SchemaVersion` or `DataKey::SchemaVersion`).

### Key Functions

1. **`get_schema_version(env: Env) -> u32`**
   - Returns the current schema version number stored in contract instance storage.
   - Defaults to `1` (`INITIAL_SCHEMA_VERSION`) if no custom version has been written yet.

2. **`migrate_schema(env: Env, admin: Address, target_version: u32) -> Result<(), Error>`**
   - Authorized admin-only function that updates the contract schema version to `target_version`.
   - Returns an error (`SchemaAlreadyAtTarget`) if the current stored version is already greater than or equal to `target_version`.
   - **Validates storage invariants before persisting the version (Issue #88).** Every data transformation registered for the version steps in `(current_version, target_version]` is executed *first*. `target_version` is written only after all transformations succeed, so a version can never be bumped on top of partially migrated state.

---

## 🛡️ Migration Invariant Checks (Issue #88)

`migrate_schema` never trusts the caller blindly. Before writing `target_version`, each contract runs the data migrations registered for the intermediate version steps:

| Contract | Version step | Transformation |
|---|---|---|
| `core/contracts/payment` | v1 → v2 | Re-indexes every payment in `1..=PaymentKey::Counter` into the customer index, the merchant index and the paged merchant index. |
| `core/contracts/refund` | v1 → v2 | Re-indexes every refund in `1..=RefundCounter` into the per-status index and the customer history index, and backfills `SystemKey::RefundRejectedAt` for rejected refunds. |
| `orchestrator/contracts/admin` | v1 → v2 | Re-validates the stored orchestrator configuration: the pauser and every child contract address must be present and the three child contracts must be distinct, otherwise an emergency pause could leave a role unmanaged. |

If a single entry cannot be read, or its stored id disagrees with the key it is stored under, the migration aborts with `SchemaMigrationFailed` and **the whole transaction is reverted**:

- the stored schema version stays at its previous value, so the migration can be retried after the corrupted entry is fixed;
- every write performed for the entries that *did* succeed is rolled back, so no half-migrated state survives.

```rust
// Pseudocode of the contract-side flow
if current >= target_version { return Err(SchemaAlreadyAtTarget); }
run_data_migrations(&env, current, target_version)?; // reverts on any failure
env.storage().instance().set(&schema_version_key, &target_version);
```

Reference tests: [`core/contracts/payment/src/test_schema_migration.rs`](../core/contracts/payment/src/test_schema_migration.rs) and [`core/contracts/refund/src/test_schema_migration.rs`](../core/contracts/refund/src/test_schema_migration.rs).

---

## 🗂️ Storage Key Inventory (All Four Contracts)

Soroban exposes three storage tiers. The table below catalogues every key family written by the four contracts, the tier it lives in, a rough byte budget, what extends its TTL, and what happens if it is archived.

> **Tier reminder.** `Instance` is a *single* ledger entry shared by the whole contract and is capped at **64 KB**. `Persistent` and `Temporary` are per-key entries. `Temporary` entries are *deleted* (not archived) on expiry and cannot be restored.

### `core/contracts/payment`

| Key Enum Variant | Tier | Approx. Bytes | TTL Extension Trigger | Archival Recovery Impact |
|---|---|---|---|---|
| `ConfigKey::Admin` | Instance | ~60 | `initialize` / `bump_instance_ttl` | Restored with the instance entry; no per-key action. |
| `ConfigKey::SchemaVersion` | Instance | ~40 | `migrate_schema` / `bump_instance_ttl` | Restored with the instance entry. |
| `ConfigKey::Token` / `ConfigKey::FeeBps` | Instance | ~60 each | `initialize` / `bump_instance_ttl` | Restored with the instance entry. |
| `PaymentKey::Counter` | Instance | ~40 | `create_payment` / `bump_instance_ttl` | Restored with the instance entry. |
| `PaymentKey::Data(id)` | Persistent | ~300–600 | `create_payment` / `bump_persistent_ttl` | Must be restored before `get_payment`; use `restorePreamble` or keeper. |
| `PaymentKey::CustomerIndex` / `MerchantIndex` | Persistent | grows with payments | `create_payment` / `bump_persistent_ttl` | Restore before index reads; unbounded — never move to `Instance`. |
| `SubscriptionKey::Data(id)` | Persistent | ~250 | `create_subscription` / `bump_persistent_ttl` | Restore before subscription reads. |
| `CustomerDataKey::Analytics(addr)` | Persistent | ~120 | `record_payment` / `bump_persistent_ttl` | Restore before analytics reads. |
| `MerchantDataKey::Analytics(addr)` | Persistent | ~120 | `record_payment` / `bump_persistent_ttl` | Restore before analytics reads. |
| `FeatureKey::*` | Instance | ~40 each | `set_feature` / `bump_instance_ttl` | Restored with the instance entry. |
| `StateKey::Paused` | Instance | ~40 | `pause` / `bump_instance_ttl` | Restored with the instance entry. |

### `core/contracts/escrow`

| Key Enum Variant | Tier | Approx. Bytes | TTL Extension Trigger | Archival Recovery Impact |
|---|---|---|---|---|
| `ConfigKey::Admin` / `ConfigKey::SchemaVersion` | Instance | ~60 / ~40 | `initialize` / `migrate_schema` | Restored with the instance entry. |
| `EscrowKey::Counter` | Instance | ~40 | `create_escrow` | Restored with the instance entry. |
| `EscrowKey::Data(id)` | Persistent | ~400–800 | `create_escrow` / `bump_persistent_ttl` | Restore before `get_escrow`; use `restorePreamble` or keeper. |
| `ParticipantKey::Escrows(addr)` | Persistent | grows with escrows | `create_escrow` / `bump_persistent_ttl` | Restore before participant reads; unbounded — never move to `Instance`. |
| `DisputeKey::Data(id)` | Persistent | ~300 | `raise_dispute` / `bump_persistent_ttl` | Restore before dispute reads. |
| `VoteWeight` | Instance | ~40 | `initialize` | Restored with the instance entry. |
| `ReleaseThresholdBps` | Instance | ~40 | `initialize` | Restored with the instance entry. |

### `core/contracts/refund`

| Key Enum Variant | Tier | Approx. Bytes | TTL Extension Trigger | Archival Recovery Impact |
|---|---|---|---|---|
| `SystemKey::SchemaVersion` | Instance | ~40 | `migrate_schema` | Restored with the instance entry. |
| `SystemKey::RefundCounter` | Instance | ~40 | `request_refund` | Restored with the instance entry. |
| `SystemKey::RefundRejectedAt(id)` | Persistent | ~60 | `reject_refund` / `bump_persistent_ttl` | Restore before rejection reads. |
| `DataKey::Refund(id)` | Persistent | ~350–700 | `request_refund` / `bump_persistent_ttl` | Restore before `get_refund`; use `restorePreamble` or keeper. |
| `DataKey::StatusIndex(status)` | Persistent | grows with refunds | `request_refund` / `bump_persistent_ttl` | Restore before status queries; unbounded — never move to `Instance`. |
| `DataKey::CustomerHistory(addr)` | Persistent | grows with refunds | `request_refund` / `bump_persistent_ttl` | Restore before history reads; unbounded — never move to `Instance`. |
| `PolicyKey::RefundPolicyVersion(addr, v)` / `PolicyKey::RefundPolicyVersionCount(addr)` | Persistent | ~80 each | `set_policy` / `bump_persistent_ttl` | Restore before policy reads. |
| `ArbitrationKey::*` | Persistent | ~200 | `open_arbitration` / `bump_persistent_ttl` | Restore before arbitration reads. |
| `EvidenceKey::*` | Persistent | ~200 | `submit_evidence` / `bump_persistent_ttl` | Restore before evidence reads. |
| `VoucherKey::*` | Persistent | ~120 | `issue_voucher` / `bump_persistent_ttl` | Restore before voucher reads. |
| `TokenKey::*` | Instance | ~40 each | `initialize` | Restored with the instance entry. |
| `RefundExtKey::*` | Persistent | ~120 | `extend_refund` / `bump_persistent_ttl` | Restore before extension reads. |
| `EligibilityKey::*` | Persistent | ~120 | `set_eligibility` / `bump_persistent_ttl` | Restore before eligibility reads. |

### `orchestrator/contracts/admin`

| Key Enum Variant | Tier | Approx. Bytes | TTL Extension Trigger | Archival Recovery Impact |
|---|---|---|---|---|
| `ConfigKey::Admin` / `ConfigKey::Pauser` | Instance | ~60 each | `initialize` / `bump_instance_ttl` | Restored with the instance entry. |
| `ConfigKey::SchemaVersion` | Instance | ~40 | `migrate_schema` | Restored with the instance entry. |
| `ConfigKey::PaymentContract` / `EscrowContract` / `RefundContract` | Instance | ~60 each | `initialize` / `bump_instance_ttl` | Restored with the instance entry. |
| `ConfigKey::Paused` | Instance | ~40 | `pause` / `bump_instance_ttl` | Restored with the instance entry. |

> **⚠️ Instance storage is a single 64 KB entry.** Never place unbounded maps, per-user records, or any collection whose size grows with usage inside `Instance`. Doing so risks exceeding the 64 KB cap and bricking *every* instance read for the contract. User-keyed records belong in `Persistent` (or `Temporary` when loss is acceptable).

---

## 🚚 Chunked Migration Runbook

Large migrations must be executed in bounded batches so a single transaction never exceeds the ledger's CPU/IO budget. The contracts expose three entrypoints for this:

- **`dry_run_migrate_schema(env, admin, target_version, batch_size) -> MigrationReport`** — simulates the migration for one batch and returns the number of entries that *would* be transformed, without writing anything.
- **`migrate_schema_step(env, admin, target_version, batch_size) -> MigrationCursor`** — transforms up to `batch_size` entries and returns the cursor for the next batch.
- **`get_migration_cursor(env) -> Option<MigrationCursor>`** — returns the persisted cursor so an operator can resume after a crash or timeout.

### Workflow

1. **Dry run** the first batch to size the work:

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID --source $ADMIN_KEY --network $NETWORK \
     -- dry_run_migrate_schema \
     --admin $ADMIN_ADDR --target_version 2 --batch_size 50
   ```

2. **Step** through batches until the cursor reports completion:

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID --source $ADMIN_KEY --network $NETWORK \
     -- migrate_schema_step \
     --admin $ADMIN_ADDR --target_version 2 --batch_size 50
   ```

3. **Resume / inspect** the cursor at any time:

   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID --source $ADMIN_KEY --network $NETWORK \
     -- get_migration_cursor
   ```

4. When the cursor reports `done`, the schema version has been bumped to `target_version` and the migration is complete.

### Ledger Budget Guidance

| Batch size | Approx. CPU (insns) | Approx. read/write entries | Notes |
|---|---|---|---|
| 25 | ~5M | ~50 | Safest; use for large contracts. |
| 50 | ~10M | ~100 | Default recommendation. |
| 100 | ~20M | ~200 | Only when the contract is small and the network is quiet. |

Keep each batch comfortably below the network's per-transaction instruction limit (currently ~100M on mainnet) so a retry after a timeout is cheap. If a batch fails, the cursor is unchanged and the batch can be retried idempotently.

---

## 🛠️ Contributor Workflow: Changing Stored Data Shapes

When modifying an existing stored data structure (such as adding fields to a struct, modifying enum variants, or restructuring storage keys), contributors must adhere to the following workflow:

1. **Assess Breaking Changes**:
   - Determine if the change breaks backwards compatibility with existing on-chain data.
   - Adding non-optional fields or re-interpreting existing byte encodings requires a schema migration.

2. **Define Migration Logic**:
   - Update `migrate_schema()` in the relevant contract (e.g., [`core/contracts/payment/src/lib.rs`](../core/contracts/payment/src/lib.rs) or [`core/contracts/refund/src/lib.rs`](../core/contracts/refund/src/lib.rs)) to handle reading historical data shapes and writing upgraded data structures.
   - Register the per-version transformation in `run_data_migrations()` and return `SchemaMigrationFailed` when an entry cannot be transformed, so the failure reverts the transaction instead of silently bumping the version.

3. **Increment Target Schema Version**:
   - Ensure contract calls specify the new target version integer (`target_version > current_version`).

4. **Add & Update Unit Tests**:
   - Create or update contract tests to verify that:
     - `get_schema_version()` starts at `1` after contract `initialize()`.
     - `migrate_schema()` successfully increments the version when called by an authorized admin.
     - Calling `migrate_schema()` with a target version `<= current_version` fails with `SchemaAlreadyAtTarget`.
     - A failing entry migration leaves the stored version untouched and rolls back every partial write (Issue #88).

### ⚠️ Backward-Incompatible XDR Pitfalls

Soroban encodes `#[contracttype]` enums and structs by **name**, not position. That makes some edits safe and others silently corrupting:

- **Reordering enum variants is safe** — position carries no meaning.
- **Renaming a struct field is a breaking change.** The field name is part of the XDR map key; old data will fail to decode. Bump the schema version and migrate.
- **Renaming an enum variant is a breaking change.** The variant name is the storage key; old data becomes unreachable. Bump the schema version and migrate.
- **Adding a non-optional struct field is a breaking change.** Old data lacks the field. Bump the schema version and migrate.
- **Spelling a variant name twice is a silent alias.** Two enums that both contain `Foo(1)` serialize to the same bytes and share a slot. Keep one owner per name.

Any of the breaking changes above **must** be accompanied by a schema version bump and a registered migration step; otherwise the contract will read garbage or panic on decode.

---

## 🔑 Data Key Namespacing Conventions

Issue #86 audited every `enum DataKey` / `enum PaymentKey` / `enum ConfigKey`
family in the repository for key collisions. This section documents the rules
those contracts follow, because they are the only thing standing between a
renamed variant and silent state corruption.

### Why Names Matter More Than Positions

Soroban does **not** encode a `#[contracttype]` enum by its position. It encodes
it as a `ScVal::Vec` whose first element is a `ScVal::Symbol` holding the
**variant name**, followed by one element per tuple field:

```
ConfigKey::Admin              ->  Vec [ Symbol("Admin") ]
PaymentKey::Data(7)           ->  Vec [ Symbol("Data"), U32(7) ]
DataKey::Config(ConfigKey::Admin)
                              ->  Vec [ Symbol("Config"), Vec [ Symbol("Admin") ] ]
```

Two practical consequences:

- **Inserting or reordering variants is safe.** Position carries no meaning, so
  appending a variant in the middle of an enum does not move existing data.
- **Spelling a variant name twice is a silent alias.** `DataKey::X(Foo(1))` and
  `SomeOtherKey::Foo(1)` serialize to the *same* bytes and therefore read and
  write the *same* storage slot. The compiler will not complain.

### The Two Namespacing Styles Used Here

| Contract | Style | Isolation mechanism |
| --- | --- | --- |
| `core/contracts/payment` | Single outer `DataKey` wrapping seven inner enums (`Config`, `Payment`, `Subscription`, `Feature`, `Customer`, `Merchant`, `State`) | The **outer** variant name is the namespace, so `DataKey::Customer(CustomerDataKey::Analytics(a))` and `DataKey::Merchant(MerchantDataKey::Analytics(a))` are distinct slots despite the shared inner name. |
| `core/contracts/escrow` | Single outer `DataKey` wrapping four inner enums (`Config`, `Escrow`, `Participant`, `Dispute`) plus two un-namespaced keys (`VoteWeight`, `ReleaseThresholdBps`) | Same mechanism. The un-namespaced keys are deliberate direct slots and are audited alongside the namespaced ones. |
| `core/contracts/refund` | **Flat.** Nine independent key enums (`DataKey`, `ArbitrationKey`, `PolicyKey`, `SystemKey`, `EvidenceKey`, `VoucherKey`, `TokenKey`, `RefundExtKey`, `EligibilityKey`) are written straight to `env.storage().instance()`. | **No namespace at all** — every variant name in every one of those nine enums must be globally unique. |

Because the refund contract is flat, it is the most exposed to this class of bug.
It previously carried `RefundPolicyVersion(Address, u32)` and
`RefundPolicyVersionCount(Address)` in *both* `DataKey` and `PolicyKey`; the two
spellings aliased one slot. `PolicyKey` is now the single documented owner and
`DataKey` must never spell those names again. Because the encoding is
name-based, the fix changed **no on-chain bytes** and needs no migration.

### Rules for Contributors

1. **One spelling, one owner.** A given variant name may appear in exactly one key enum per contract. If you need the same logical key in two places, wrap it in an outer namespace instead of duplicating the name.
2. **Never rename a variant without a schema bump.** The name *is* the storage key; renaming it orphans the old data.
3. **Keep unbounded collections out of `Instance`.** Index maps and per-user records belong in `Persistent` (or `Temporary` when loss is acceptable).
4. **Audit new keys against the inventory above.** Add the new key to the table in this document in the same PR that introduces it.

---

## 🔗 Related Documentation

- [Storage Restoration & Archival Recovery](./STORAGE_RESTORATION.md) — decision matrix for `restorePreamble` vs. manual keeper restoration.
- [Operational Runbook](./OPERATIONAL_RUNBOOK.md) — day-2 operations, including migration and restoration procedures.
- [Architecture](./ARCHITECTURE.md) — contract topology and storage model overview.
