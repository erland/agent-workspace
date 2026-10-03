import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LocalVolumeObjectStore } from "../src/storage/local-volume-object-store.js";

describe("LocalVolumeObjectStore", () => {
  it("stores and removes temporary workspace objects under its configured root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-workspace-store-"));
    try {
      const store = new LocalVolumeObjectStore(root);
      await store.put("workspaces/u1/ws1/source.zip", new Uint8Array([1,2,3]));
      assert.deepEqual([...await store.get("workspaces/u1/ws1/source.zip")], [1,2,3]);
      await store.deletePrefix("workspaces/u1/ws1/");
      assert.equal(await store.exists("workspaces/u1/ws1/source.zip"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects paths that escape the storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-workspace-store-"));
    try {
      const store = new LocalVolumeObjectStore(root);
      await assert.rejects(() => store.put("../escape", new Uint8Array([1])), /Invalid storage key/);
      await assert.rejects(() => store.get("/absolute"), /Invalid storage key/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
