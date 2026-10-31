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

  it("contains six Java/Node combinations plus optional Playwright", () => {
    assert.deepEqual(Object.keys(RUNTIME_PROFILES).sort(), [
      "java17-node20",
      "java17-node22",
      "java21-node20",
      "java21-node22",
      "java25-node20",
      "java25-node22",
      "playwright-chromium-node22"
    ]);
  });


  it("uses prebuilt versioned GHCR images without per-workspace bootstrap", () => {
    for (const profile of Object.values(RUNTIME_PROFILES).filter(profile => profile.id !== "playwright-chromium-node22")) {
      assert.equal(
        profile.imageRef,
        `ghcr.io/erland/agent-workspace-runtime:${profile.id}-v5`
      );
      assert.deepEqual(profile.bootstrapCommands, []);
    }
  });
  it("selects the versioned Playwright image explicitly and rejects incompatible runtimes", () => {
    const profile = resolveRuntimeProfile({ playwright: true });
    assert.equal(profile.id, "playwright-chromium-node22");
    assert.equal(profile.imageRef, "ghcr.io/erland/agent-workspace-runtime:playwright-chromium-node22-v5");
    assert.throws(() => resolveRuntimeProfile({ playwright: true, java: "25" }), /requires Java 21 and Node 22/);
  });
  it("resolves an explicitly requested Java 25 / Node 20 runtime", () => {
    const profile = resolveRuntimeProfile({ java: "25", node: "20" });
    assert.equal(profile.id, "java25-node20");
    assert.equal(profile.imageRef, "ghcr.io/erland/agent-workspace-runtime:java25-node20-v5");
    assert.deepEqual(profile.bootstrapCommands, []);
  });
});
