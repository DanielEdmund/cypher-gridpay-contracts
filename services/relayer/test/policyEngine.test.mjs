import test from "node:test";
import assert from "node:assert/strict";
import { Asset, Keypair, Operation } from "@stellar/stellar-sdk";
import { InMemoryQuotaStore } from "../dist/quotaStore.js";
import { RelayerError } from "../dist/errors.js";
import {
  CONTRACT_HEX,
  FakeRpc,
  makeConfig,
  makeInnerTransaction,
  makePaymentOperation,
  makePolicy,
  OTHER_CONTRACT_ID,
} from "./helpers.mjs";

async function runPolicy({ operations, entrypoint, fee, contractId, simulationResult, configOverrides = {}, storeOverrides } = {}) {
  const config = makeConfig(configOverrides);
  const rpc = new FakeRpc({ simulationResult });
  const store = new InMemoryQuotaStore(
    storeOverrides ?? { customer: config.customerDailyLimit, merchant: config.merchantDailyLimit },
    config.redisKeyPrefix,
  );
  const policy = makePolicy(config, rpc, store);
  const { transaction, source } = makeInnerTransaction({ operations, entrypoint, fee, contractId });
  const evaluate = (extra = {}) => policy.evaluate({
    transactionXdr: transaction.toXDR(),
    customerId: source.publicKey(),
    ...extra,
  });
  return { config, rpc, store, evaluate, source };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RelayerError);
    assert.equal(error.code, code);
    return true;
  });
}

test("policy accepts a whitelisted create_payment invoke and reserves quotas", async () => {
  const { evaluate, source, store, rpc } = await runPolicy();
  const decision = await evaluate({ merchantId: "merchant-1" });
  assert.deepEqual(decision.contractIds, [CONTRACT_HEX]);
  assert.deepEqual(decision.entrypoints, ["create_payment"]);
  assert.equal(decision.customer, source.publicKey());
  assert.equal(store.usage("customer", source.publicKey()), 1);
  assert.equal(store.usage("merchant", "merchant-1"), 1);
  assert.equal(rpc.simulations.length, 1);
});

test("policy rejects Payment, ChangeTrust, SetOptions and AccountMerge operations", async () => {
  const operations = [
    makePaymentOperation(),
    Operation.changeTrust({ asset: new Asset("USDC", Keypair.random().publicKey()) }),
    Operation.setOptions({ inflationDest: Keypair.random().publicKey() }),
    Operation.accountMerge({ destination: Keypair.random().publicKey() }),
  ];
  for (const operation of operations) {
    const { evaluate } = await runPolicy({ operations: [operation] });
    await expectCode(evaluate(), "DISALLOWED_OPERATION");
  }
});

test("policy rejects a non-whitelisted contract target", async () => {
  const { evaluate } = await runPolicy({ contractId: OTHER_CONTRACT_ID });
  await expectCode(evaluate(), "UNWHITELISTED_CONTRACT");
});

test("policy rejects an unapproved entrypoint", async () => {
  const { evaluate } = await runPolicy({ entrypoint: "drain_funds" });
  await expectCode(evaluate(), "UNAPPROVED_ENTRYPOINT");
});

test("policy rejects fees above MAX_SPONSORED_STROOPS", async () => {
  const { evaluate } = await runPolicy({ fee: "200001" });
  await expectCode(evaluate(), "EXCESSIVE_FEE");
});

test("policy rejects a reverting simulation", async () => {
  for (const simulationResult of [
    { error: "HostError: Error(Contract, #1)", results: [], restoreRequired: false },
    { results: [{ error: "trapped" }], restoreRequired: false },
  ]) {
    const { evaluate } = await runPolicy({ simulationResult });
    await expectCode(evaluate(), simulationResult.error === undefined ? "SIMULATION_REVERTED" : "SIMULATION_FAILED");
  }
});

test("policy rejects transactions requiring ledger entry restoration", async () => {
  const { evaluate } = await runPolicy({
    simulationResult: { results: [{}], restoreRequired: true },
  });
  await expectCode(evaluate(), "SIMULATION_RESTORE_REQUIRED");
});

test("policy rejects quota-exceeded callers", async () => {
  const { evaluate, source, store } = await runPolicy({ configOverrides: { customerDailyLimit: 1 } });
  await evaluate();
  await expectCode(evaluate(), "QUOTA_EXCEEDED");
  assert.equal(store.usage("customer", source.publicKey()), 1);
});

test("policy releases the customer reservation when the merchant quota fails", async () => {
  const { evaluate, source, store } = await runPolicy({
    storeOverrides: { customer: 10, merchant: 0 },
  });
  await expectCode(evaluate({ merchantId: "merchant-2" }), "QUOTA_EXCEEDED");
  assert.equal(store.usage("customer", source.publicKey()), 0);
});

test("policy rejects a fee-bump transaction supplied as the inner XDR", async () => {
  const config = makeConfig();
  const rpc = new FakeRpc();
  const store = new InMemoryQuotaStore({ customer: 10 }, config.redisKeyPrefix);
  const { transaction } = makeInnerTransaction();
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    config.channels[0].accountId,
    "200",
    transaction,
    config.networkPassphrase,
  );
  await expectCode(
    makePolicy(config, rpc, store).evaluate({ transactionXdr: bump.toXDR() }),
    "INNER_FEE_BUMP_REJECTED",
  );
});

test("policy rejects malformed XDR", async () => {
  const config = makeConfig();
  await expectCode(
    makePolicy(config, new FakeRpc(), new InMemoryQuotaStore()).evaluate({ transactionXdr: "not-xdr" }),
    "INVALID_XDR",
  );
});
