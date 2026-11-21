import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { RemoteKmsSigner } from "../dist/signer.js";
import { makeConfig, makeInnerTransaction } from "./helpers.mjs";

test("KMS signer requests a signature for the fee source and attaches it", async () => {
  const channel = Keypair.random();
  const config = makeConfig({
    channels: [{ accountId: channel.publicKey(), sequence: "1" }],
  });
  const { transaction } = makeInnerTransaction();
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    channel.publicKey(),
    "100",
    transaction,
    config.networkPassphrase,
  );
  const signature = channel.sign(bump.hash());
  let requestedBody;
  const fetchImpl = async (_url, init) => {
    requestedBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ signature: signature.toString("base64") }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const signer = new RemoteKmsSigner({
    url: "http://kms.invalid/sign",
    keys: { [channel.publicKey()]: "key-channel-1" },
    fetchImpl,
  });

  const signed = await signer.sign(bump);
  assert.equal(requestedBody.keyId, "key-channel-1");
  assert.equal(requestedBody.publicKey, channel.publicKey());
  assert.equal(requestedBody.algorithm, "ed25519");
  assert.equal(signed.signatures.length, 1);
  assert.ok(channel.verify(signed.hash(), signature));
});

test("KMS signer rejects a fee source without a configured key", async () => {
  const { transaction } = makeInnerTransaction();
  const config = makeConfig();
  const bump = TransactionBuilder.buildFeeBumpTransaction(
    config.channels[0].accountId,
    "100",
    transaction,
    config.networkPassphrase,
  );
  const signer = new RemoteKmsSigner({ url: "http://kms.invalid/sign", keys: {} });
  await assert.rejects(signer.sign(bump), /No KMS key configured/);
});
