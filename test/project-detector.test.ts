import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateZipArchive } from "../src/archive/archive-validator.js";
import { analyzeProjectArchive } from "../src/project/project-detector.js";
import type { RuntimeProfileId } from "../src/core/runtime-profile.js";
import { makeStoredZip } from "./zip-fixture.js";

function analyze(entries: Array<{ path: string; content: string }>, runtime: RuntimeProfileId = "java21-node22") {
  const archive = makeStoredZip(entries);
  return analyzeProjectArchive(archive, validateZipArchive(archive), { workspaceRuntimeProfile: runtime });
}

describe("project/runtime detection", () => {
  it("detects Maven Java 25 from maven.compiler.release", () => {
    const result = analyze([{ path: "pom.xml", content: `<project><properties><maven.compiler.release>25</maven.compiler.release></properties></project>` }]);
    assert.equal(result.projectType, "MAVEN");
    assert.equal(result.java?.version, "25");
    assert.equal(result.java?.supported, true);
    assert.equal(result.recommendedRuntime.java, "25");
    assert.ok(result.warnings.some((w) => w.code === "JAVA_RUNTIME_MISMATCH"));
  });

  it("resolves a Maven java.version property reference", () => {
    const result = analyze([{ path: "pom.xml", content: `<project><properties><java.version>17</java.version><maven.compiler.release>${"${java.version}"}</maven.compiler.release></properties></project>` }], "java17-node22");
    assert.equal(result.java?.version, "17");
    assert.equal(result.warnings.some((w) => w.code === "JAVA_RUNTIME_MISMATCH"), false);
  });

  it("detects Node 20 from .nvmrc before package metadata", () => {
    const result = analyze([
      { path: "package.json", content: JSON.stringify({ engines: { node: ">=22" } }) },
      { path: ".nvmrc", content: "20.19.0\n" }
    ]);
    assert.equal(result.projectType, "NPM");
    assert.equal(result.node?.version, "20");
    assert.equal(result.node?.source, ".nvmrc");
    assert.ok(result.warnings.some((w) => w.code === "NODE_RUNTIME_MISMATCH"));
  });

  it("detects Volta and engines metadata", () => {
    const volta = analyze([{ path: "package.json", content: JSON.stringify({ volta: { node: "22.12.0" } }) }]);
    assert.equal(volta.node?.version, "22");
    assert.match(volta.node?.source ?? "", /volta\.node/);

    const engines = analyze([{ path: "package.json", content: JSON.stringify({ engines: { node: "^20.10.0" } }) }], "java21-node20");
    assert.equal(engines.node?.version, "20");
    assert.match(engines.node?.source ?? "", /engines\.node/);
  });

  it("uses Java21/Node22 defaults when runtime metadata is absent", () => {
    const result = analyze([{ path: "package.json", content: "{}" }]);
    assert.equal(result.recommendedRuntime.java, "21");
    assert.equal(result.recommendedRuntime.node, "22");
  });

  it("reports unsupported Java and Node versions without silently mapping them", () => {
    const result = analyze([
      { path: "pom.xml", content: `<project><properties><java.version>11</java.version></properties></project>` },
      { path: "package.json", content: JSON.stringify({ engines: { node: "18.x" } }) }
    ]);
    assert.equal(result.projectType, "MAVEN_NPM");
    assert.equal(result.java?.version, "11");
    assert.equal(result.node?.version, "18");
    assert.ok(result.warnings.some((w) => w.code === "UNSUPPORTED_JAVA_VERSION"));
    assert.ok(result.warnings.some((w) => w.code === "UNSUPPORTED_NODE_VERSION"));
    assert.deepEqual(result.recommendedRuntime, { java: "21", node: "22" });
  });

  it("ignores package.json files inside node_modules", () => {
    const result = analyze([{ path: "node_modules/a/package.json", content: "{}" }]);
    assert.equal(result.projectType, "UNKNOWN");
  });

  it("reports ambiguous multi-manifest projects", () => {
    const result = analyze([
      { path: "frontend/package.json", content: "{}" },
      { path: "admin/package.json", content: "{}" }
    ]);
    assert.equal(result.projectType, "NPM");
    assert.ok(result.warnings.some((w) => w.code === "AMBIGUOUS_PROJECT"));
  });
});
