import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_RUNTIME_PROFILE_ID,
  DEFAULT_RUNTIME_IMAGE_VERSION,
  RUNTIME_PROFILES,
  assertTauriBuildOnlyRiskWindow,
  resolveRuntimeProfile
} from "../src/core/runtime-profile.js";

describe("runtime profiles", () => {
  it("uses Java 21 and Node 22 as the default", () => {
    assert.equal(resolveRuntimeProfile().id, DEFAULT_RUNTIME_PROFILE_ID);
    assert.equal(DEFAULT_RUNTIME_PROFILE_ID, "java21-node22");
  });

  it("contains six Java/Node combinations plus optional Playwright", () => {
    assert.deepEqual(Object.keys(RUNTIME_PROFILES).sort(), [
      "go",
      "java17-node20",
      "java17-node22",
      "java21-node20",
      "java21-node22",
      "java25-node20",
      "java25-node22",
      "playwright-chromium-node22",
      "rust",
      "tauri-linux"
    ]);
  });


  it("uses prebuilt versioned GHCR images without per-workspace bootstrap", () => {
    for (const profile of Object.values(RUNTIME_PROFILES).filter(profile => profile.id !== "playwright-chromium-node22" && profile.id !== "rust" && profile.id !== "go" && profile.id !== "tauri-linux")) {
      assert.equal(
        profile.imageRef,
        `ghcr.io/erland/agent-workspace-runtime:${profile.id}-v${DEFAULT_RUNTIME_IMAGE_VERSION}`
      );
      assert.deepEqual(profile.bootstrapCommands, []);
    }
  });
  it("selects the versioned Playwright image explicitly and rejects incompatible runtimes", () => {
    const profile = resolveRuntimeProfile({ playwright: true });
    assert.equal(profile.id, "playwright-chromium-node22");
    assert.equal(profile.imageRef, `ghcr.io/erland/agent-workspace-runtime:playwright-chromium-node22-v${DEFAULT_RUNTIME_IMAGE_VERSION}`);
    assert.throws(() => resolveRuntimeProfile({ playwright: true, java: "25" }), /requires Java 21 and Node 22/);
  });
  it("selects a dedicated Rust image without Java and Node, independently versioned", () => {
    const p = resolveRuntimeProfile({rust:true});
    assert.equal(p.id,"rust");
    assert.equal(p.java,undefined);
    assert.equal(p.node,undefined);
    assert.equal(p.imageRef,"ghcr.io/erland/agent-workspace-runtime:rust-v1");
    assert.deepEqual(p.bootstrapCommands,[]);
    for (const input of [{rust:true,java:"21" as const},{rust:true,node:"22" as const},{rust:true,playwright:true}]) {
      assert.throws(()=>resolveRuntimeProfile(input),/cannot be combined/);
    }
    assert.equal(resolveRuntimeProfile().id,"java21-node22");
  });

  it("selects the Tauri image with Rust and Node 22 while preserving other profiles", () => {
    const p = resolveRuntimeProfile({tauri:true});
    assert.equal(p.id,"tauri-linux");
    assert.equal(p.java,undefined);
    assert.equal(p.node,"22");
    assert.equal(p.imageRef,"ghcr.io/erland/agent-workspace-runtime:tauri-linux-v1");
    assert.deepEqual(p.bootstrapCommands,[]);
    assert.equal(resolveRuntimeProfile({tauri:true,node:"22"}).id,"tauri-linux");
    for(const input of [{tauri:true,java:"21" as const},{tauri:true,rust:true},{tauri:true,playwright:true},{tauri:true,node:"20" as const}]) {
      assert.throws(()=>resolveRuntimeProfile(input),/Tauri runtime requires/);
    }
    assert.equal(resolveRuntimeProfile().id,"java21-node22");
  });

  it("enforces Tauri risk acceptance expiry independently of image publication", () => {
    assert.doesNotThrow(() => assertTauriBuildOnlyRiskWindow(Date.parse("2026-12-09T23:59:59Z")));
    assert.throws(() => assertTauriBuildOnlyRiskWindow(Date.parse("2026-12-10T00:00:00Z")), /expired/);
    assert.throws(() => assertTauriBuildOnlyRiskWindow(Date.parse("2027-01-01T00:00:00Z")), /expired/);
    assert.throws(() => assertTauriBuildOnlyRiskWindow(NaN), /expired/);
  });

  it("resolves an explicitly requested Java 25 / Node 20 runtime", () => {
    const profile = resolveRuntimeProfile({ java: "25", node: "20" });
    assert.equal(profile.id, "java25-node20");
    assert.equal(profile.imageRef, `ghcr.io/erland/agent-workspace-runtime:java25-node20-v${DEFAULT_RUNTIME_IMAGE_VERSION}`);
    assert.deepEqual(profile.bootstrapCommands, []);
  });
});
