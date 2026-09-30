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


  it("normalizes apt sources to HTTPS before apt-get update", () => {
    for (const profile of Object.values(RUNTIME_PROFILES)) {
      const command = profile.bootstrapCommands[0]?.argv.join(" ") ?? "";
      const httpsRewrite = command.indexOf("s|http://|https://|g");
      const aptUpdate = command.indexOf("apt-get update");
      assert.ok(httpsRewrite >= 0, `${profile.id} must rewrite apt sources to HTTPS`);
      assert.ok(aptUpdate > httpsRewrite, `${profile.id} must rewrite apt sources before apt-get update`);
    }
  });
  it("resolves an explicitly requested Java 25 / Node 20 runtime", () => {
    const profile = resolveRuntimeProfile({ java: "25", node: "20" });
    assert.equal(profile.id, "java25-node20");
    assert.equal(profile.imageRef, "eclipse-temurin:25-jdk-noble");
  });
});
