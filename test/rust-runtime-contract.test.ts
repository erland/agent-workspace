import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCreateInputSchema } from "../src/mcp/schemas.js";
import { resolveRuntimeProfile } from "../src/core/runtime-profile.js";
import { analyzeProjectArchive } from "../src/project/project-detector.js";
import { validateZipArchive } from "../src/archive/archive-validator.js";
import { makeStoredZip } from "./zip-fixture.js";

test("workspace_create accepts explicit Rust profile without Java/Node fields", () => {
  const payload = WorkspaceCreateInputSchema.parse({rust:true,lifetimeMinutes:10});
  assert.equal(resolveRuntimeProfile(payload).id,"rust");
  assert.equal(resolveRuntimeProfile({rust:false}).id,"java21-node22");
});
test("Rust profile rejects mixed runtime requests, leaving Java/Node default unchanged", () => {
  for(const args of [{rust:true,java:"21" as const},{rust:true,node:"22" as const},{rust:true,playwright:true}]){
    assert.throws(()=>resolveRuntimeProfile(WorkspaceCreateInputSchema.parse(args)),/cannot be combined/);
  }
  assert.equal(resolveRuntimeProfile({java:"25"}).id,"java25-node22");
});
test("project metadata inspection does not invent Java/Node mismatch for Rust profile", () => {
  const archive=makeStoredZip([{path:"pom.xml",content:"<project><properties><java.version>25</java.version></properties></project>"}]);
  const analysis=analyzeProjectArchive(archive,validateZipArchive(archive),{workspaceRuntimeProfile:"rust"});
  assert.equal(analysis.projectType,"MAVEN");
  assert.equal(analysis.warnings.some(w=>w.code==="JAVA_RUNTIME_MISMATCH" || w.code==="NODE_RUNTIME_MISMATCH"),false);
});
