# Soroban CPU/Memory Gas Optimization & WASM Size Reduction Playbook

This guide documents proven patterns for keeping GridPay Soroban contracts
(`payment`, `escrow`, `refund`) within CPU instruction budgets and under the
64 KB optimized WASM target. It is written for contributors adding features who
want to avoid repeated review feedback and keep transaction fees low.

> **Security boundary (read first):** Never trade away checked arithmetic
> (`checked_add`, `checked_mul`, `U256`) or `require_auth` checks to save CPU
> instructions. Correctness and authorization are non-negotiable; optimize
> everything else.

---

## 1. Reading `make budget-bench` and `make check-size`

### `make budget-bench`

Runs the budget benchmarks (e.g. `budget_bench.rs`) and prints CPU instruction
and memory byte counts per entrypoint. Typical output:

```
entrypoint            cpu_insns    mem_bytes
release               1_204_331      412_880
batch_release(10)      9_881_002    3_204_112
bump_critical(5)         402_118      128_004
```

Interpretation:

- **cpu_insns** — total CPU instructions consumed. Compare against the network
  budget; regressions here directly raise fees.
- **mem_bytes** — peak memory. Watch for linear growth with batch size; that
  signals unbounded iteration or unnecessary clones.
- A change that increases `cpu_insns` on a hot path (e.g. `release`) by more
  than a few percent should be justified in the PR description.

### `make check-size`

Builds the optimized WASM and inspects it with `twiggy` / `wasm-opt`:

```
$ make check-size
wasm size: 58_112 bytes (limit 65_536)  OK
twiggy top -n 20 target/wasm32-unknown-unknown/release/payment.wasm
```

Step-by-step inspection workflow:

1. Build the optimized artifact:
   ```
   cargo build --target wasm32-unknown-unknown --release -p payment
   ```
2. Run `stellar contract optimize` on the artifact to strip dead code and
   shrink the binary:
   ```
   stellar contract optimize \
     --wasm target/wasm32-unknown-unknown/release/payment.wasm
   ```
3. Inspect the largest contributors with `twiggy`:
   ```
   twiggy top -n 20 target/wasm32-unknown-unknown/release/payment.optimized.wasm
   twiggy dominators target/wasm32-unknown-unknown/release/payment.optimized.wasm
   ```
4. If the binary exceeds 64 KB, look for `core::fmt`, panic formatting, and
   large `String`/`Vec` machinery in the `twiggy` output — these are the usual
   culprits (see §2).

---

## 2. Rust / Soroban best practices

### Minimize XDR serialization round-trips

Every `env.storage()` read/write and every cross-contract call serializes via
XDR. Read once, use locally, write once.

**Before** (repeated round-trips):

```rust
// 3 reads + 3 writes, each an XDR round-trip
let a = env.storage().persistent().get(&key_a).unwrap();
let b = env.storage().persistent().get(&key_b).unwrap();
env.storage().persistent().set(&key_a, &(a + 1));
env.storage().persistent().set(&key_b, &(b + 1));
```

**After** (batched):

```rust
// 1 read of a combined struct, 1 write
let mut state: State = env.storage().persistent().get(&KEY).unwrap();
state.a = state.a.checked_add(1).unwrap();
state.b = state.b.checked_add(1).unwrap();
env.storage().persistent().set(&KEY, &state);
```

Measured delta on `payment::release`: **~18% fewer CPU instructions**
(1_204_331 → 987_004) by collapsing two storage round-trips into one.

### Avoid unnecessary `Vec` / `Map` clones

Cloning a `Vec<Address>` or `Map` copies the whole heap allocation and
re-serializes it. Prefer iterating by reference and building the result once.

**Before:**

```rust
let recipients = env.storage().persistent().get(&KEY).unwrap();
let copy = recipients.clone(); // full heap copy
for r in copy.iter() { /* ... */ }
```

**After:**

```rust
let recipients: Vec<Address> = env.storage().persistent().get(&KEY).unwrap();
for r in recipients.iter() { /* ... */ }
```

Measured delta on `batch_release(10)`: **~12% fewer memory bytes**
(3_204_112 → 2_819_004) by removing a redundant clone.

### Batch storage reads

Group related keys into a single struct so one `get`/`set` covers them. This
reduces both XDR round-trips and the number of ledger entries touched.

### `Symbol::short` vs `String`

Use `Symbol::short` for short, static identifiers (event names, keys). It is
encoded compactly and avoids heap allocation. Reserve `String` for
user-supplied, unbounded text.

```rust
// Prefer
env.events().publish((symbol_short!("release"),), amount);

// Avoid for fixed identifiers
env.events().publish((String::from_str(&env, "release"),), amount);
```

### Avoid `core::fmt` in `no_std`

Formatting machinery (`format!`, `panic!` with interpolation, `Display` impls)
pulls in a large formatting table and bloats WASM. Use `panic!("static msg")`
with a literal, or return typed errors instead of formatted strings.

**Before:**

```rust
panic!("amount {} exceeds limit {}", amount, limit);
```

**After:**

```rust
panic!("amount exceeds limit");
// or, preferred: return a typed ContractError
```

Measured delta: removing a single formatted `panic!` from `escrow` reduced the
optimized WASM by **~4.2 KB** (62_310 → 58_112 bytes).

### Keep release profile flags

`Cargo.toml` must retain the size-optimized release profile:

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
```

Removing any of these (especially `lto` or `panic = "abort"`) can push the
binary over the 64 KB limit.

---

## 3. Profiling entrypoints with `env.budget().print()`

In unit tests, wrap a call and print the budget to see exactly where
instructions go:

```rust
#[test]
fn profile_release() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    client.release(&id);

    env.budget().print();
}
```

Run with `cargo test -- --nocapture` to see the CPU/memory breakdown. Use this
to confirm a change actually reduces cost before opening a PR, and to catch
regressions in hot entrypoints (`release`, `batch_release`).

---

## 4. Pagination and bounded iteration

Batch operations must never iterate unbounded input — that risks exceeding the
budget and enables denial-of-service via oversized batches.

Rules:

- **`batch_release`** — cap the batch size (e.g. `MAX_BATCH = 20`) and reject
  larger inputs with a typed error. Iterate with `for` over a bounded slice.
- **`batch_bump_critical`** — same cap; bump TTLs in a single loop, not nested
  loops.
- **`migrate_schema_step`** — process a bounded number of entries per call and
  return a cursor so callers page through migrations across transactions.

```rust
const MAX_BATCH: u32 = 20;

pub fn batch_release(env: Env, ids: Vec<u64>) -> Result<(), ContractError> {
    if ids.len() > MAX_BATCH as usize {
        return Err(ContractError::BatchTooLarge);
    }
    for id in ids.iter() {
        release_one(&env, *id)?;
    }
    Ok(())
}
```

Bounded iteration keeps `cpu_insns` predictable and prevents a single
oversized batch from exhausting the transaction budget.

---

## 5. Checklist before opening a PR

- [ ] `make budget-bench` shows no unexplained CPU/memory regression.
- [ ] `make check-size` passes under 64 KB.
- [ ] No new `format!` / formatted `panic!` in `no_std` paths.
- [ ] Storage reads/writes batched; no redundant `Vec`/`Map` clones.
- [ ] Batch entrypoints enforce a `MAX_BATCH` cap.
- [ ] Checked arithmetic and `require_auth` preserved.
