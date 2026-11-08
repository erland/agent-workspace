import assert from "node:assert/strict";
import test from "node:test";
import { selectProjectRoot, selectVerificationTargets, aggregateVerification, assertRuntimeCompatibility } from "../src/workspace/workspace-service.js";
import type { ProjectAnalysis } from "../src/project/project-detector.js";

function analysis(projectManifests: ProjectAnalysis["projectManifests"]): ProjectAnalysis {
  return { projectType:"MAVEN_NPM", projectRoots:[...new Set(projectManifests.map(x=>x.root))], projectManifests,
    recommendedRuntime:{java:"21",node:"22"},warnings:[] };
}

test("Maven reactor defaults to parent project root", () => {
  const a = analysis([{root:"",type:"MAVEN"},{root:"api",type:"MAVEN"},{root:"common",type:"MAVEN"}]);
  assert.deepEqual(selectProjectRoot(a),{root:"",type:"MAVEN"});
  assert.deepEqual(selectProjectRoot(a,"api"),{root:"api",type:"MAVEN"});
});
test("single nested manifest is selected automatically", () => {
  assert.deepEqual(selectProjectRoot(analysis([{root:"app",type:"NPM"}])),{root:"app",type:"NPM"});
});
test("independent projects require a deliberate choice", () => {
  const a = analysis([{root:"admin",type:"NPM"},{root:"frontend",type:"NPM"}]);
  assert.throws(()=>selectProjectRoot(a),/Specify projectRoot/);
  assert.deepEqual(selectProjectRoot(a,"frontend"),{root:"frontend",type:"NPM"});
});
test("mixed Maven and Node project requires explicit root", () => {
  const a = analysis([{root:"",type:"MAVEN"},{root:"web",type:"NPM"}]);
  assert.throws(()=>selectProjectRoot(a),/Specify projectRoot/);
  assert.deepEqual(selectProjectRoot(a,"web"),{root:"web",type:"NPM"});
});
test("invalid or unknown roots are rejected before execution", () => {
  const a=analysis([{root:"frontend",type:"NPM"}]);
  for (const p of ["../frontend","/frontend","frontend/../backend","missing"]) {
    assert.throws(()=>selectProjectRoot(a,p));
  }
});

test("Python-only project root is selectable for verification but not build", () => {
  const a = analysis([{root:"backend",type:"PYTHON"}]);
  assert.deepEqual(selectProjectRoot(a, undefined, true), {root:"backend",type:"PYTHON"});
  assert.throws(() => selectProjectRoot(a), /Python build is not supported/);
});

test("mixed Python/Node root is not silently verified", () => {
  const a = analysis([{root:"",type:"NPM"},{root:"",type:"PYTHON"}]);
  assert.throws(() => selectProjectRoot(a, undefined, true), /Mixed projects require explicit projectRoot/);
  assert.throws(() => selectProjectRoot(a, "", true), /Mixed Maven\/npm manifests/);
});

test("coordinates npm and Python sharing one root", () => {
  const a = analysis([{root:"",type:"NPM"},{root:"",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a), [{root:"",type:"NPM"},{root:"",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a, ""), [{root:"",type:"NPM"},{root:"",type:"PYTHON"}]);
});

test("coordinates npm root and nested Python, preserving explicit single-root selection", () => {
  const a = analysis([{root:"",type:"NPM"},{root:"backend",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a), [{root:"",type:"NPM"},{root:"backend",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a, "backend"), [{root:"backend",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a, ""), [{root:"",type:"NPM"}]);
});

test("coordinates Maven, npm, Python but avoids duplicate Maven reactor modules", () => {
  const a = analysis([{root:"",type:"MAVEN"},{root:"api",type:"MAVEN"},{root:"web",type:"NPM"},{root:"checks",type:"PYTHON"}]);
  assert.deepEqual(selectVerificationTargets(a), [{root:"",type:"MAVEN"},{root:"web",type:"NPM"},{root:"checks",type:"PYTHON"}]);
});

test("mixed aggregation includes every required sub-result and never hides failures", () => {
  const passed = {status:"PASSED" as const,projectType:"NPM" as const,durationMs:10,steps:[{name:"test",argv:["npm","test"],status:"PASSED" as const,exitCode:0,durationMs:10,stdout:"ok",stderr:""}]};
  const blocked = {status:"BLOCKED" as const,projectType:"PYTHON" as const,durationMs:7,steps:[],failureSummary:"no Python tests"};
  const failed = {status:"FAILED" as const,projectType:"PYTHON" as const,durationMs:8,steps:[],failedStep:"test",exitCode:2,failureSummary:"assertion"};
  const okResult = aggregateVerification([{projectRoot:"",result:passed},{projectRoot:"backend",result:{...blocked,status:"PASSED" as const}}]);
  assert.equal(okResult.status,"PASSED");
  assert.equal(okResult.projectType,"MIXED");
  assert.deepEqual(okResult.steps.map(s=>s.name),["npm:.:test"]);
  assert.equal(okResult.subResults?.length,2);
  const blockedResult = aggregateVerification([{projectRoot:"",result:passed},{projectRoot:"backend",result:blocked}]);
  assert.equal(blockedResult.status,"BLOCKED");
  const failResult = aggregateVerification([{projectRoot:"",result:passed},{projectRoot:"backend",result:failed}]);
  assert.equal(failResult.status,"FAILED");
  assert.equal(failResult.failedStep,"python:backend:test");
  assert.equal(failResult.exitCode,2);
});

test("Gradle root is selected and is included in mixed verification", () => {
  assert.deepEqual(selectProjectRoot(analysis([{root:"backend",type:"GRADLE"}])),{root:"backend",type:"GRADLE"});
  const mix=analysis([{root:"web",type:"NPM"},{root:"backend",type:"GRADLE"}]);
  assert.deepEqual(selectVerificationTargets(mix),[{root:"web",type:"NPM"},{root:"backend",type:"GRADLE"}]);
  assert.deepEqual(selectVerificationTargets(mix,"backend"),[{root:"backend",type:"GRADLE"}]);
});

test("Cargo workspace selects parent and rejects mixed-runtime verification",()=>{
 const a=analysis([{root:"",type:"CARGO"},{root:"crates/core",type:"CARGO"}]);
 assert.deepEqual(selectProjectRoot(a),{root:"",type:"CARGO"});
 assert.deepEqual(selectVerificationTargets(a),[{root:"",type:"CARGO"}]);
 assert.doesNotThrow(()=>assertRuntimeCompatibility("rust",["CARGO"]));
 assert.throws(()=>assertRuntimeCompatibility("java21-node22",["CARGO"]),/rust:true/);
 assert.throws(()=>assertRuntimeCompatibility("rust",["MAVEN"]),/Cargo projects only/);
 assert.throws(()=>assertRuntimeCompatibility("rust",["CARGO","NPM"]),/separate workspaces/);
});
test("Cargo and Java in separate directories may be selected with an explicit root",()=>{
 const a=analysis([{root:"backend",type:"MAVEN"},{root:"native",type:"CARGO"}]);
 assert.deepEqual(selectVerificationTargets(a,"native"),[{root:"native",type:"CARGO"}]);
 assert.deepEqual(selectProjectRoot(a,"backend"),{root:"backend",type:"MAVEN"});
});
