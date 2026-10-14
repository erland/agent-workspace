import assert from "node:assert/strict";
import { it } from "node:test";
import { logCompletedTiming, timedOperation } from "../src/diagnostics/operation-timing.js";

it("diagnostic timing never changes result or thrown error", async () => {
  const original = console.info;
  console.info = () => { throw new Error("log sink failed"); };
  try {
    assert.equal(await timedOperation("diagnostic_test", async () => 42), 42);
    await assert.rejects(timedOperation("diagnostic_test", async () => {
      throw new Error("original failure");
    }), /original failure/);
    assert.doesNotThrow(() => logCompletedTiming("operation", 0, "failure", "ws_test"));
  } finally {
    console.info = original;
  }
});

it("authenticated timing emits a workspace correlation identifier", () => {
  const logs: string[] = [];
  const original = console.info;
  console.info = (message: string) => { logs.push(message); };
  try {
    logCompletedTiming("workspace_upload_zip", 0, "success", "ws_test");
  } finally {
    console.info = original;
  }
  const entry = JSON.parse(logs[0]!);
  assert.equal(entry.workspaceId, "ws_test");
  assert.equal(entry.status, "success");
  assert.equal(entry.operation, "workspace_upload_zip");
  assert.equal(typeof entry.durationMs, "number");
});
