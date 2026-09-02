import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForTransactionCompletion } from "../src/storage-transaction.ts";

test("transaction writes do not resolve before the complete event", async () => {
  const transaction = new EventTarget();
  Object.defineProperty(transaction, "error", {
    configurable: true,
    value: null,
  });

  let settled = false;
  const completion = waitForTransactionCompletion(transaction);
  completion.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);

  transaction.dispatchEvent(new Event("complete"));
  await completion;
  assert.equal(settled, true);
});
