import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCapabilities } from "../src/core/capabilities.js";

describe("getCapabilities", () => {
  it("reports the complete v1 runtime matrix", () => {
    const capabilities = getCapabilities();

    assert.deepEqual(capabilities.runtimes.java.supported, ["17", "21", "25"]);
    assert.equal(capabilities.runtimes.java.default, "21");
    assert.deepEqual(capabilities.runtimes.node.supported, ["20", "22"]);
    assert.equal(capabilities.runtimes.node.default, "22");
    assert.deepEqual(capabilities.provider.runtimeProfiles, [
      "java17-node20",
      "java17-node22",
      "java21-node20",
      "java21-node22",
      "java25-node20",
      "java25-node22"
    ]);
  });

  it("reports Chromium screenshot capability after DEV-009", () => {
    const capabilities = getCapabilities();
    assert.equal(capabilities.browser.chromium, true);
    assert.equal(capabilities.browser.screenshots, true);
  });

  it("reports npm and Maven without advertising unimplemented build systems", () => {
    const capabilities = getCapabilities();
    assert.deepEqual(capabilities.buildSystems, ["maven", "npm"]);
  });
});
