import assert from "node:assert/strict";
import test from "node:test";
import { selectProjectRoot } from "../src/workspace/workspace-service.js";
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
