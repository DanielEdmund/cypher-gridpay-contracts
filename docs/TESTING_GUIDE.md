# Cypher GridPay Testing Strategy & Verification Pyramid

This guide describes the five testing layers used across the Cypher GridPay
contracts and explains **when** to write each type of test and **how** to
structure deterministic fixtures. Read it before adding a new contract feature
or fixing a bug — every change should land with the appropriate layer(s) of
test coverage.

```
        ▲  Layer 5: Differential WASM (native vs wasm32)
       ▲▲  Layer 4: Property-based & stateful fuzzing
      ▲▲▲  Layer 3: Cross-contract integration (tests/e2e)
     ▲▲▲▲  Layer 2: Authorization & reentrancy
    ▲▲▲▲▲  Layer 1: Unit tests & branch coverage
```

Run the whole pyramid locally with:

```bash
make test            # unit + integration + property tests
make differential    # native vs WASM differential tests
make update-snapshots # refresh Soroban SDK snapshots after intentional changes
```

---

## Layer 1 — Unit Tests & Branch Coverage

Unit tests live next to the code they exercise, in `test_*.rs` files inside the
contract crate (e.g. `core/contracts/refund/src/test_arbitration_fees.rs`).

**Conventions**

- File naming: `test_<feature>.rs`; register each module from `lib.rs` with
  `#[cfg(test)] mod test_<feature>;`.
- Test naming: `test_<behavior>_<condition>` (e.g.
  `test_request_refund_rejects_unknown_payment`).
- One logical assertion per test where practical; assert on returned values and
  emitted events, not just `is_ok()`.
- Cover every branch: happy path, each guard/`panic!`, and each `if/else` arm.

**Shared fixtures — `core/test_utils`**

Use the shared helpers instead of hand-rolling mocks so fixtures stay
deterministic across crates:

- Mock SEP-41 token registration and minting helpers.
- Time helpers that set `env.ledger()` timestamps/sequence numbers.
- Standard admin/merchant/customer address fixtures.

```rust
use crate::test_utils::{setup_env, register_mock_token, advance_time};

#[test]
fn test_release_escrow_after_dispute_window() {
    let env = setup_env();
    let (token, merchant) = register_mock_token(&env, 1_000);
    // ... create escrow, then move the ledger past the dispute window
    advance_time(&env, 7 * 24 * 60 * 60);
    // assert release succeeds and funds moved
}
```

---

## Layer 2 — Authorization & Reentrancy

Authorization bugs are the highest-severity class in this repo. Test them
explicitly.

**Auth rejection without `mock_all_auths`**

`env.mock_all_auths()` bypasses the auth framework entirely — never use it in a
test that is supposed to prove a caller is rejected. Instead, set the caller
and assert the call panics with an auth error:

```rust
#[test]
#[should_panic]
fn test_release_escrow_rejects_non_admin() {
    let env = setup_env();
    let attacker = Address::generate(&env);
    // Do NOT call env.mock_all_auths() here.
    env.as_contract(&contract_id, || {
        client.mock_auths(&[]).release_escrow(&attacker, &escrow_id);
    });
}
```

**Malicious SEP-41 tokens (reentrancy)**

Simulate a token whose `transfer` re-enters the contract to prove state is
updated before external calls (checks-effects-interactions):

```rust
#[test]
fn test_refund_is_reentrancy_safe() {
    let env = setup_env();
    // Register a mock token whose transfer callback re-invokes process_refund.
    let token = register_reentrant_token(&env);
    // The second (reentrant) call must fail or be a no-op; balances must not
    // be double-spent.
}
```

---

## Layer 3 — Cross-Contract Integration

End-to-end flows that span multiple contracts (payment → escrow → refund) live
in `tests/e2e/src/lib.rs`. Use these when a change touches more than one
contract's interface or shared storage assumptions.

```bash
cargo test -p e2e            # from the repo root
```

Keep e2e tests focused on the integration seam; push fine-grained branch
coverage down to Layer 1.

---

## Layer 4 — Property-Based & Stateful Fuzzing

Use `proptest` for invariants that must hold for *all* inputs, and stateful
fuzzing for sequences of operations.

- `test_fixed_math_prop.rs` — arithmetic invariants (no overflow, monotonicity).
- `state_machine_fuzz.rs` — random sequences of contract calls; asserts
  invariants after every step.

**Shrinking failing seeds**

When a property fails, `proptest` shrinks to a minimal counterexample. Commit
the shrunk case to `proptest-regressions/` so the regression is replayed on
every run:

```bash
git add core/contracts/*/proptest-regressions/
```

Never delete `proptest-regressions/` files — they are the durable record of
past failures.

---

## Layer 5 — Differential WASM Testing & Snapshots

Native `cargo test` runs on the host target; production runs on `wasm32`.
Differential tests (`differential_wasm.rs`) execute the same scenario on both
targets and assert identical results, catching target-specific arithmetic or
serialization drift.

```bash
make differential       # native vs wasm32 comparison
make update-snapshots   # regenerate Soroban SDK snapshots after intentional changes
```

Only run `make update-snapshots` when a change is *intentionally* altering
observable behavior; review the snapshot diff before committing.

---

## Time Travel: Manipulating `env.ledger()` Safely

Timelocks, expirations, dunning intervals, and TTL bumps all depend on ledger
state. Manipulate it through the shared helpers so tests stay deterministic:

```rust
use crate::test_utils::advance_time;

// Advance timestamp AND sequence number together — never bump one alone,
// or TTL/expiration logic will diverge from real network behavior.
advance_time(&env, 30 * 24 * 60 * 60); // 30 days
```

Guidelines:

- Always advance timestamp and sequence number together via `advance_time`.
- For TTL bumps, advance past the entry's live-until ledger and assert the
  entry is restored (or rejected) as expected.
- For dunning intervals, step exactly to the boundary and one ledger past it.
- Never hard-code absolute ledger numbers; derive them from the current
  `env.ledger()` so tests survive snapshot updates.

---

## Templates

### New contract feature

```rust
// core/contracts/<crate>/src/test_<feature>.rs
use crate::test_utils::{setup_env, register_mock_token, advance_time};

#[test]
fn test_<feature>_happy_path() {
    let env = setup_env();
    let (token, merchant) = register_mock_token(&env, 1_000);
    // arrange -> act -> assert
}

#[test]
#[should_panic]
fn test_<feature>_rejects_unauthorized() {
    let env = setup_env();
    // no mock_all_auths; assert auth failure
}
```

### Bug-fix regression test

```rust
// Name it after the bug so it is greppable.
#[test]
fn test_regression_<issue>_<short_description>() {
    let env = setup_env();
    // Reproduce the exact failing scenario from the bug report.
    // Assert the corrected behavior.
}
```

---

## Checklist Before Opening a PR

- [ ] New behavior has Layer 1 unit tests covering all branches.
- [ ] Auth-sensitive paths have Layer 2 rejection tests (no `mock_all_auths`).
- [ ] Cross-contract changes have Layer 3 e2e coverage.
- [ ] Invariants have Layer 4 property tests; failing seeds committed.
- [ ] `make test` and `make differential` pass locally.
