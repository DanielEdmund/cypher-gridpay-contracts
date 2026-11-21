import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { ChannelPool } from "../dist/channelPool.js";
import { ChannelUnavailableError } from "../dist/errors.js";
import { FakeRpc, silentLogger } from "./helpers.mjs";

function states(count, sequence = "1") {
  return Array.from({ length: count }, () => ({ accountId: Keypair.random().publicKey(), sequence }));
}

test("channel leases are exclusive and handed off to waiting callers", async () => {
  const pool = new ChannelPool(states(2), { acquireTimeoutMs: 100 });
  const first = await pool.acquire();
  const second = await pool.acquire();
  assert.equal(pool.available(), 0);
  assert.notEqual(first.accountId, second.accountId);
  const pending = pool.acquire();
  let resolved = false;
  void pending.then(() => { resolved = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(resolved, false);
  first.succeed();
  const third = await pending;
  assert.equal(third.accountId, first.accountId);
  assert.equal(first.sequence, "2");
  second.succeed();
  third.succeed();
  assert.equal(pool.available(), 2);
});

test("successful lease advances the local sequence", async () => {
  const pool = new ChannelPool(states(1, "41"));
  const lease = await pool.acquire();
  assert.equal(lease.sequence, "41");
  lease.succeed();
  assert.equal(pool.sequenceOf(lease.accountId), "42");
});

test("failed lease refreshes the sequence from RPC", async () => {
  const account = states(1, "7")[0];
  const rpc = new FakeRpc({
    accountResult: { accountId: account.accountId, sequence: "12", nativeBalanceStroops: 1000 },
  });
  const pool = new ChannelPool([account], { rpc, logger: silentLogger() });
  const lease = await pool.acquire();
  lease.fail("tx_bad_seq");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pool.sequenceOf(account.accountId), "12");
  assert.deepEqual(rpc.accountReads, [account.accountId]);
});

test("acquire times out when every channel is leased", async () => {
  const pool = new ChannelPool(states(1), { acquireTimeoutMs: 20 });
  const lease = await pool.acquire();
  await assert.rejects(pool.acquire(), ChannelUnavailableError);
  lease.succeed();
});

test("pool rejects duplicate channel accounts", () => {
  const duplicate = states(1)[0];
  assert.throws(() => new ChannelPool([duplicate, duplicate]), /Duplicate channel account/);
});
