import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_RUNTIME_PROFILE_ID,
  RUNTIME_PROFILES,
  resolveRuntimeProfile
} from "../src/core/runtime-profile.js";

describe("runtime profiles", () => {
  it("uses Java 21 and Node 22 as the default", () => {
    assert.equal(resolveRuntimeProfile().id, DEFAULT_RUNTIME_PROFILE_ID);
    assert.equal(DEFAULT_RUNTIME_PROFILE_ID, "java21-node22");
  });

  it("contains all six supported Java/Node combinations", () => {
    assert.deepEqual(Object.keys(RUNTIME_PROFILES).sort(), [
      "java17-node20",
      "java17-node22",
      "java21-node20",
      "java21-node22",
      "java25-node20",
      "java25-node22"
    ]);
  });


  it("uses prebuilt versioned GHCR images without per-workspace bootstrap", () => {
    for (const profile of Object.values(RUNTIME_PROFILES)) {
      assert.equal(
        profile.imageRef,
        `ghcr.io/erland/agent-workspace-runtime:${profile.id}-v3`
      );
      assert.deepEqual(profile.bootstrapCommands, []);
    }
  });
  it("resolves an explicitly requested Java 25 / Node 20 runtime", () => {
    const profile = resolveRuntimeProfile({ java: "25", node: "20" });
    assert.equal(profile.id, "java25-node20");
    assert.equal(profile.imageRef, "ghcr.io/erland/agent-workspace-runtime:java25-node20-v3");
    assert.deepEqual(profile.bootstrapCommands, []);
  });
});
