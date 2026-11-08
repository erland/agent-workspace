import assert from "node:assert/strict";
import test from "node:test";
import type { SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, Command, ExecutionResult } from "../src/core/sandbox-provider.js";
import { VerifierRegistry, defaultVerifierRegistry, type VerifierRegistration } from "../src/verification/verifier-registry.js";
import { MavenVerifier } from "../src/verification/maven-verifier.js";
import { CargoVerifier } from "../src/verification/cargo-verifier.js";
import { GradleVerifier } from "../src/verification/gradle-verifier.js";
import { NpmVerifier } from "../src/verification/npm-verifier.js";
import { PythonVerifier } from "../src/verification/python-verifier.js";

class RecordingProvider implements SandboxProvider {
  commands: Command[] = [];
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "one" };
  }
  async uploadArchive(): Promise<void> {}
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    if (command.argv[0] === "bash" && command.argv[2]?.includes("mvnw")) {
      return { exitCode: 0, stdout: "mvn", stderr: "" };
    }
    if (command.argv[0] === "node" && command.argv[1] === "-e") {
      return { exitCode: 0, stdout: '{"hasPackageLock":false,"scripts":{}}', stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(): Promise<void> {}
}

const fakeHandle = { providerId: "fake", providerWorkspaceId: "one" };
test("registry lists existing build-system manifests without introducing new runtimes", () => {
  assert.deepEqual(defaultVerifierRegistry.list(), [
    {kind:"CARGO",manifests:["Cargo.toml"]},
    {kind:"GRADLE",manifests:["build.gradle","build.gradle.kts"]},
    {kind:"MAVEN",manifests:["pom.xml"]},
    {kind:"NPM",manifests:["package.json"]},
    {kind:"PYTHON",manifests:["pyproject.toml","requirements.txt","uv.lock"]}
  ]);
});

test("registry creates the three existing verifier implementations with root isolation", async () => {
  const provider = new RecordingProvider();
  const context = {provider,projectRoot:"/workspace/project/backend",playwrightRuntime:false};
  assert.ok(defaultVerifierRegistry.create("MAVEN",context) instanceof MavenVerifier);
  assert.ok(defaultVerifierRegistry.create("CARGO",context) instanceof CargoVerifier);
  assert.ok(defaultVerifierRegistry.create("GRADLE",context) instanceof GradleVerifier);
  assert.ok(defaultVerifierRegistry.create("NPM",context) instanceof NpmVerifier);
  assert.ok(defaultVerifierRegistry.create("PYTHON",context) instanceof PythonVerifier);
  const result = await defaultVerifierRegistry.create("MAVEN",context).verify(fakeHandle);
  assert.equal(result.status, "PASSED");
  assert.equal(result.projectType, "MAVEN");
  assert.ok(provider.commands.every(c=>c.workdir==="/workspace/project/backend"));
});

test("rejects duplicate and empty-manifest registrations", () => {
  const entry: VerifierRegistration = {
    kind:"MAVEN", manifests:["pom.xml"],
    create:()=>({verify:async()=>({status:"PASSED",projectType:"MAVEN",durationMs:0,steps:[]})})
  };
  assert.throws(()=>new VerifierRegistry([entry,entry]),/Duplicate verifier registration/);
  assert.throws(()=>new VerifierRegistry([{...entry,manifests:[]}]),/no discovery manifests/);
});

test("does not silently fall back when a verifier is missing", () => {
  const registry = new VerifierRegistry([]);
  assert.throws(()=>registry.get("PYTHON"),/No verifier registered/);
  assert.throws(()=>registry.create("NPM",{provider:new RecordingProvider(),projectRoot:"/workspace/project",playwrightRuntime:false}),/No verifier registered/);
});
