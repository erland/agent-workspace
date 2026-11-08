import assert from "node:assert/strict";
import test from "node:test";
import type { Command, CreateWorkspaceOptions, ExecutionResult, SandboxProvider, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import { PythonVerifier } from "../src/verification/python-verifier.js";

const handle: WorkspaceHandle = {providerId:"fake", providerWorkspaceId:"fake"};
const ok = (stdout = ""): ExecutionResult => ({exitCode:0,stdout,stderr:""});
const fail = (code: number, stderr = ""): ExecutionResult => ({exitCode:code,stdout:"",stderr});
const inspection = (more: Record<string, boolean> = {}) =>
  ok(JSON.stringify({requirements:false,pyproject:false,uvlock:false,tests:true,pytest:false,...more}));

class MockProvider implements SandboxProvider {
  commands: Command[] = [];
  constructor(private readonly responses: ExecutionResult[]) {}
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> { return handle; }
  async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}
  async readFile(_handle: WorkspaceHandle, _path: string): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(_handle: WorkspaceHandle): Promise<void> {}
  async exec(_handle: WorkspaceHandle, cmd: Command): Promise<ExecutionResult> {
    this.commands.push(cmd);
    const result = this.responses.shift();
    if (!result) throw new Error("Unexpected command " + cmd.argv.join(" "));
    return result;
  }
}

test("Python requirements project uses isolated venv and unittest without global pip", async () => {
  const provider = new MockProvider([inspection({requirements:true}),ok(),ok(),inspection({requirements:true}),ok("tests"),ok("Ran 1 test\nOK")]);
  const result = await new PythonVerifier(provider).verify(handle);
  assert.equal(result.status,"PASSED");
  assert.deepEqual(result.steps.map(s=>s.name),["venv","dependencies","test"]);
  assert.deepEqual(provider.commands[1]?.argv,["python3","-m","venv",".agent-workspace-venv"]);
  assert.deepEqual(provider.commands[2]?.argv?.slice(0,4),[".agent-workspace-venv/bin/python","-m","pip","install"]);
  assert.deepEqual(provider.commands[5]?.argv?.slice(0,3),[".agent-workspace-venv/bin/python","-m","unittest"]);
});

test("Python pyproject tests use installed pytest", async () => {
  const provider = new MockProvider([inspection({pyproject:true}),ok(),ok(),inspection({pyproject:true,pytest:true}),ok("1 passed")]);
  const result = await new PythonVerifier(provider,{projectRoot:"/workspace/project/backend"}).verify(handle);
  assert.equal(result.status,"PASSED");
  assert.deepEqual(provider.commands[2]?.argv?.slice(-2),["-e","."]);
  assert.deepEqual(provider.commands[4]?.argv,[".agent-workspace-venv/bin/python","-m","pytest","-q"]);
  assert.ok(provider.commands.every(c=>c.workdir==="/workspace/project/backend"));
});

test("install failures stop verification and preserve normalized failure info", async () => {
  const provider = new MockProvider([inspection({requirements:true}),ok(),fail(7,"No matching distribution found")]);
  const result = await new PythonVerifier(provider).verify(handle);
  assert.equal(result.status,"FAILED");
  assert.equal(result.failedStep,"dependencies");
  assert.equal(result.exitCode,7);
  assert.match(result.failureSummary??"",/No matching/);
  assert.equal(provider.commands.length,3);
});

test("unsupported uv lock does not silently install unpinned packages", async () => {
  const provider = new MockProvider([inspection({uvlock:true,pyproject:true})]);
  const result = await new PythonVerifier(provider).verify(handle);
  assert.equal(result.status,"BLOCKED");
  assert.match(result.failureSummary??"",/uv.lock/);
  assert.equal(provider.commands.length,1);
});

test("empty tests and pytest exit 5 are BLOCKED, never PASS", async () => {
  const empty = new MockProvider([inspection({tests:false}),ok(),inspection({tests:false})]);
  assert.equal((await new PythonVerifier(empty).verify(handle)).status,"BLOCKED");
  const none = new MockProvider([inspection(),ok(),inspection({pytest:true}),fail(5,"no tests ran")]);
  assert.equal((await new PythonVerifier(none).verify(handle)).status,"BLOCKED");
});

test("unittest zero tests are BLOCKED", async () => {
  const provider = new MockProvider([inspection(),ok(),inspection(),ok("tests"),ok("Ran 0 tests\nOK")]);
  assert.equal((await new PythonVerifier(provider).verify(handle)).status,"BLOCKED");
});
