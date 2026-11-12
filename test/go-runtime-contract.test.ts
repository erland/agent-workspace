import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCreateInputSchema } from "../src/mcp/schemas.js";
import { resolveRuntimeProfile } from "../src/core/runtime-profile.js";
import { analyzeProjectArchive } from "../src/project/project-detector.js";
import { validateZipArchive } from "../src/archive/archive-validator.js";
import { makeStoredZip } from "./zip-fixture.js";
import { assertRuntimeCompatibility } from "../src/workspace/workspace-service.js";

test("Go runtime can be selected without altering defaults", () => {
  const request = WorkspaceCreateInputSchema.parse({go:true});
  assert.equal(resolveRuntimeProfile({go:request.go}).id,"go");
  assert.match(resolveRuntimeProfile({go:true}).imageRef,/go-v1$/);
  assert.equal(resolveRuntimeProfile().id,"java21-node22");
  for (const conflict of [{go:true,rust:true},{go:true,tauri:true},{go:true,node:"22" as const},{go:true,playwright:true},{go:true,java:"21" as const}]) {
    assert.throws(()=>resolveRuntimeProfile(conflict),/cannot be combined/);
  }
});

test("go.mod project is detected, and verification cannot silently pass", () => {
  const zip = makeStoredZip([{path:"app/go.mod",content:"module example.com/app\ngo 1.27\n"}]);
  const analysis = analyzeProjectArchive(zip,validateZipArchive(zip),{workspaceRuntimeProfile:"go"});
  assert.equal(analysis.projectType,"GO");
  assert.deepEqual(analysis.projectManifests,[{root:"app",type:"GO"}]);
  assert.throws(()=>assertRuntimeCompatibility("go",["GO"]),/not implemented/);
  assert.throws(()=>assertRuntimeCompatibility("java21-node22",["GO"]),/require/);
});

test("go.work root takes precedence over nested modules", () => {
  const zip = makeStoredZip([{path:"go.work",content:"go 1.27\nuse ./app\n"},{path:"app/go.mod",content:"module example.com/app\ngo 1.26\n"}]);
  const analysis = analyzeProjectArchive(zip,validateZipArchive(zip),{workspaceRuntimeProfile:"go"});
  assert.deepEqual(analysis.projectManifests,[{root:"",type:"GO"}]);
});
