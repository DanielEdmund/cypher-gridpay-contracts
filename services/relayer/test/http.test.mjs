import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../dist/index.js";
import { PolicyViolationError } from "../dist/errors.js";
import { silentLogger } from "./helpers.mjs";

async function withServer(t, relayer, maxBodyBytes = 1024) {
  const server = createServer({ relayer, logger: silentLogger(), maxBodyBytes });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("GET /healthz returns ok", async (t) => {
  const base = await withServer(t, { async sponsor() { throw new Error("not called"); } });
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("POST /v1/relayer/sponsor returns the relayer result", async (t) => {
  const base = await withServer(t, {
    async sponsor(payload) {
      assert.equal(payload.transactionXdr, "xdr");
      return { hash: "abc", feeStroops: 200 };
    },
  });
  const response = await fetch(`${base}/v1/relayer/sponsor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactionXdr: "xdr" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hash: "abc", feeStroops: 200 });
});

test("HTTP layer maps relayer errors to their status codes", async (t) => {
  const base = await withServer(t, {
    async sponsor() {
      throw new PolicyViolationError("UNWHITELISTED_CONTRACT", "Contract target is not whitelisted", {
        contractId: "deadbeef",
      });
    },
  });
  const response = await fetch(`${base}/v1/relayer/sponsor`, {
    method: "POST",
    body: JSON.stringify({ transactionXdr: "xdr" }),
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "UNWHITELISTED_CONTRACT");
  assert.equal(body.error.details.contractId, "deadbeef");
});

test("HTTP layer rejects malformed and oversized bodies", async (t) => {
  const base = await withServer(t, { async sponsor() { return {}; } }, 64);
  const malformed = await fetch(`${base}/v1/relayer/sponsor`, { method: "POST", body: "not-json" });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(`${base}/v1/relayer/sponsor`, {
    method: "POST",
    body: JSON.stringify({ transactionXdr: "x".repeat(200) }),
  });
  assert.equal(oversized.status, 413);
});

test("unknown routes return 404 and GET on sponsor returns 405", async (t) => {
  const base = await withServer(t, { async sponsor() { return {}; } });
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/v1/relayer/sponsor`)).status, 405);
});
