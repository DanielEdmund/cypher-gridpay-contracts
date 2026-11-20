import test from "node:test";
import assert from "node:assert/strict";
import { FeeBumpTransaction, Keypair } from "@stellar/stellar-sdk";
import { RelayerError } from "../dist/errors.js";
import { InMemoryQuotaStore } from "../dist/quotaStore.js";
import { CONTRACT_HEX, FakeRpc, makeConfig, makeInnerTransaction, makeRelayer } from "./helpers.mjs";

function requestFor(transaction, extra = {}) {
  return { transactionXdr: transaction.toXDR(), ...extra };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RelayerError);
    assert.equal(error.code, code);
    return true;
  });
}

test("sponsor builds a signed fee bump, confirms it and logs exact stroop spend", async () => {
  const rpc = new FakeRpc();
  const { service, pool, ledger, quotaStore } = makeRelayer({ rpc });
  const { transaction, source } = makeInnerTransaction();
  const result = await service.sponsor(requestFor(transaction, { merchantId: "merchant-9" }));

  assert.equal(result.hash, "hash-1");
  assert.deepEqual(result.contractIds, [CONTRACT_HEX]);
  assert.deepEqual(result.entrypoints, ["create_payment"]);
  assert.equal(result.feeStroops, 200);
  assert.equal(result.innerFeeStroops, 100);
  assert.equal(result.incrementalStroops, 100);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].merchant, "merchant-9");
  assert.equal(ledger.records[0].customer, source.publicKey());
  assert.equal(ledger.records[0].feeStroops, 200);
  assert.equal(quotaStore.usage("customer", source.publicKey()), 1);
  assert.equal(quotaStore.usage("merchant", "merchant-9"), 1);

  const submitted = rpc.submissions[0];
  assert.ok(submitted instanceof FeeBumpTransaction);
  assert.equal(submitted.feeSource, result.channelAccount);
  assert.equal(submitted.innerTransaction.hash().toString("hex"), result.innerHash);
  assert.equal(submitted.signatures.length, 1);
  assert.equal(pool.available(), 2);
});

test("sponsor halts when the relayer balance is below the safety floor and alerts SREs", async () => {
  const rpc = new FakeRpc({
    accountResult: { accountId: "GACCOUNT", sequence: "1", nativeBalanceStroops: 999 },
  });
  const config = makeConfig({ safetyFloorStroops: 1_000 });
  const { service, pool, alerts, quotaStore } = makeRelayer({ config, rpc });
  const { transaction, source } = makeInnerTransaction();

  await expectCode(service.sponsor(requestFor(transaction)), "INSUFFICIENT_RELAYER_BALANCE");
  assert.equal(alerts.messages.length, 1);
  assert.match(alerts.messages[0].message, /safety floor/i);
  assert.equal(quotaStore.usage("customer", source.publicKey()), 0);
  assert.equal(pool.available(), 2);
});

test("sponsor releases quotas when the sponsored transaction fails on-ledger", async () => {
  const rpc = new FakeRpc({ transactionResult: { status: "FAILED" } });
  const { service, pool, ledger, quotaStore } = makeRelayer({ rpc });
  const { transaction, source } = makeInnerTransaction();

  await expectCode(service.sponsor(requestFor(transaction)), "ON_LEDGER_FAILURE");
  assert.equal(ledger.records.length, 0);
  assert.equal(quotaStore.usage("customer", source.publicKey()), 0);
  assert.equal(pool.available(), 2);
});

test("sponsor retries once after tx_bad_seq with a refreshed channel", async () => {
  const rpc = new FakeRpc({
    sendHandler: (_transaction, attempt) => attempt === 1
      ? { status: "ERROR", errorResult: "tx_bad_seq" }
      : { status: "PENDING", hash: "hash-2" },
    accountHandler: (accountId) => ({ accountId, sequence: "9", nativeBalanceStroops: 100_000_000 }),
  });
  const { service, pool, ledger } = makeRelayer({ rpc });
  const { transaction } = makeInnerTransaction();

  const result = await service.sponsor(requestFor(transaction));
  assert.equal(result.hash, "hash-2");
  assert.equal(rpc.submissions.length, 2);
  assert.equal(ledger.records.length, 1);
  assert.equal(pool.sequenceOf(result.channelAccount), "10");
});

test("sponsor rejects a fee-bump fee above MAX_SPONSORED_STROOPS", async () => {
  const config = makeConfig({ maxSponsoredStroops: 201, feeBumpBaseFeeStroops: 200 });
  const rpc = new FakeRpc();
  const { service, quotaStore } = makeRelayer({ config, rpc });
  const { transaction, source } = makeInnerTransaction({ fee: "100" });

  await expectCode(service.sponsor(requestFor(transaction)), "EXCESSIVE_FEE");
  assert.equal(quotaStore.usage("customer", source.publicKey()), 0);
  assert.equal(rpc.submissions.length, 0);
});

test("25 concurrent sponsorships complete without tx_bad_seq or channel collisions", async () => {
  const keypairs = Array.from({ length: 5 }, () => Keypair.random());
  const config = makeConfig({
    channels: keypairs.map((keypair) => ({ accountId: keypair.publicKey(), sequence: "1" })),
    testKeypairs: keypairs,
    customerDailyLimit: 50,
  });
  const active = new Set();
  let maxConcurrent = 0;
  const rpc = new FakeRpc({
    sendHandler: (transaction) => {
      if (active.has(transaction.feeSource)) throw new Error("tx_bad_seq: channel used concurrently");
      active.add(transaction.feeSource);
      maxConcurrent = Math.max(maxConcurrent, active.size);
      return new Promise((resolve) => setTimeout(() => {
        active.delete(transaction.feeSource);
        resolve({ status: "PENDING", hash: `hash-${transaction.innerTransaction.sequence}` });
      }, 2));
    },
  });
  const store = new InMemoryQuotaStore({ customer: 50 }, config.redisKeyPrefix);
  const { service, pool, ledger } = makeRelayer({ config, rpc, quotaStore: store });

  const requests = Array.from({ length: 25 }, (_, index) => {
    const { transaction } = makeInnerTransaction({ sequence: String(index + 1) });
    return service.sponsor(requestFor(transaction));
  });
  const results = await Promise.all(requests);

  assert.equal(results.length, 25);
  assert.equal(new Set(results.map((result) => result.hash)).size, 25);
  assert.equal(ledger.records.length, 25);
  assert.ok(maxConcurrent >= 2 && maxConcurrent <= 5);
  assert.equal(pool.available(), 5);
  assert.equal(rpc.submissions.length, 25);
});
