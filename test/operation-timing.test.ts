import assert from "node:assert/strict";
import { it } from "node:test";
import { executionTimeoutMs } from "../src/workspace/workspace-service.js";
import { timedOperation } from "../src/diagnostics/operation-timing.js";

it("rounds Modal timeouts down to whole seconds without extending lifetime", () => {
  assert.equal(executionTimeoutMs(585810), 585000);
  assert.equal(executionTimeoutMs(1000), 1000);
  assert.equal(executionTimeoutMs(1999), 1000);
  assert.equal(executionTimeoutMs(700000), 600000);
  assert.throws(() => executionTimeoutMs(999), /less than one second/);
  assert.throws(() => executionTimeoutMs(0), /less than one second/);
  assert.throws(() => executionTimeoutMs(Number.NaN), /less than one second/);
});

it("timing preserves results, errors and operation behavior", async () => {
  assert.equal(await timedOperation("test_success", async () => 42), 42);
  await assert.rejects(timedOperation("test_failure", async () => {
    throw new Error("original error");
  }), /original error/);
});
