import assert from "node:assert/strict";
import test from "node:test";
import type { Command, SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, ExecutionResult } from "../src/core/sandbox-provider.js";
import { GoVerifier } from "../src/verification/go-verifier.js";
import { defaultVerifierRegistry } from "../src/verification/verifier-registry.js";

const handle: WorkspaceHandle = { providerId: "fake", providerWorkspaceId: "go" };
const pass = (stdout = ""): ExecutionResult => ({ exitCode: 0, stdout, stderr: "" });
const passingJson = JSON.stringify({ Action: "pass", Package: "example/app", Test: "TestSum" }) + "\n";
class FakeProvider implements SandboxProvider {
  commands: Command[] = [];
  failOn = "";
  probe = "module";
  testOutput = passingJson;
  work = JSON.stringify({ Use: [{ DiskPath: "./a" }, { DiskPath: "./b" }] });
  async createWorkspace(_o: CreateWorkspaceOptions): Promise<WorkspaceHandle> { return handle; }
  async uploadArchive(): Promise<void> {}
  async terminate(): Promise<void> {}
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async exec(_h: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    const name = command.argv[0] === "bash" && command.argv[2]?.startsWith("if [ -f") ? "probe"
      : command.argv[0] === "bash" ? "format" : command.argv[1] === "work" ? "work"
      : command.argv[1] === "mod" ? "dependencies" : command.argv[1] === "vet" ? "vet" : "test";
    if (name === this.failOn) return { exitCode: 7, stdout: "", stderr: "Go check failed" };
    if (name === "probe") return pass(this.probe);
    if (name === "work") return pass(this.work);
    if (name === "test") return pass(this.testOutput);
    return pass();
  }
}

test("Go verifier checks formatting, dependencies, vet and executed tests in isolated root", async () => {
  const provider = new FakeProvider();
  const result = await new GoVerifier(provider, { projectRoot: "/workspace/project/app" }).verify(handle);
  assert.equal(result.status, "PASSED");
  assert.equal(result.projectType, "GO");
  assert.deepEqual(result.steps.map(s => s.name), ["format", "dependencies", "vet", "test"]);
  // Login shells overwrite PATH in the deployed Alpine sandbox, hiding gofmt.
  assert.deepEqual(provider.commands[1]?.argv.slice(0, 2), ["bash", "-c"]);
  assert.ok(provider.commands.every(c => c.workdir === "/workspace/project/app"));
  assert.deepEqual(provider.commands.at(-1)?.argv, ["go", "test", "-json", "-count=1", "./..."]);
  assert.ok(provider.commands.slice(1).every(c => c.env?.GOTOOLCHAIN === "local"));
});

test("Go failures stop verification and retain failing step", async () => {
  for (const step of ["format", "dependencies", "vet", "test"]) {
    const provider = new FakeProvider();
    provider.failOn = step;
    const result = await new GoVerifier(provider).verify(handle);
    assert.equal(result.status, "FAILED", step);
    assert.equal(result.failedStep, step);
    assert.equal(result.exitCode, 7);
  }
});

test("Go without executed tests is BLOCKED despite successful go test command", async () => {
  const provider = new FakeProvider();
  provider.testOutput = JSON.stringify({ Action: "pass", Package: "example/app" }) + "\n";
  const result = await new GoVerifier(provider).verify(handle);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.failureSummary ?? "", /without reporting an executed test/);
});

test("Go workspace modules are all checked without leaving the upload root", async () => {
  const provider = new FakeProvider();
  provider.probe = "workspace";
  const result = await new GoVerifier(provider).verify(handle);
  assert.equal(result.status, "PASSED");
  assert.deepEqual(result.steps.map(s => s.name), ["a:format","a:dependencies","a:vet","a:test","b:format","b:dependencies","b:vet","b:test"]);
  assert.ok(provider.commands.every(c => c.workdir?.startsWith("/workspace/project")));
});

test("Go workspace rejects unsafe or missing modules without executing them", async () => {
  for (const bad of ["../escape", "/tmp/outside"]) {
    const provider = new FakeProvider();
    provider.probe = "workspace";
    provider.work = JSON.stringify({ Use: [{ DiskPath: bad }] });
    const result = await new GoVerifier(provider).verify(handle);
    assert.equal(result.status, "BLOCKED");
    assert.equal(provider.commands.length, 2);
  }
});

test("Go project missing manifest is BLOCKED and registered verifier is available", async () => {
  const provider = new FakeProvider();
  provider.failOn = "probe";
  assert.equal((await new GoVerifier(provider).verify(handle)).status, "BLOCKED");
  assert.ok(defaultVerifierRegistry.create("GO", { provider, projectRoot: "/workspace/project", playwrightRuntime: false }) instanceof GoVerifier);
});
