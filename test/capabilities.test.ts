import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCapabilities } from "../src/core/capabilities.js";

describe("getCapabilities", () => {
  it("reports the six standard runtimes and optional Playwright profile", () => {
    const capabilities = getCapabilities();

    assert.deepEqual(capabilities.runtimes.java.supported, ["17", "21", "25"]);
    assert.equal(capabilities.runtimes.java.default, "21");
    assert.deepEqual(capabilities.runtimes.node.supported, ["20", "22"]);
    assert.equal(capabilities.runtimes.node.default, "22");
    assert.deepEqual(capabilities.runtimes.rust,{available:true,profile:"rust"});
    assert.deepEqual(capabilities.provider.runtimeProfiles, [
      "java17-node20",
      "java17-node22",
      "java21-node20",
      "java21-node22",
      "java25-node20",
      "java25-node22",
      "playwright-chromium-node22",
      "rust"
    ]);
  });


  it("reports Python alongside npm and Maven as a supported verifier", () => {
    const capabilities = getCapabilities();
    assert.deepEqual(capabilities.buildSystems, ["maven", "npm", "python", "gradle"]);
    assert.deepEqual(capabilities.projectDetection.supported, ["maven", "npm", "python", "gradle"]);
  });
});
