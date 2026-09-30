import assert from "node:assert/strict";
import test from "node:test";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import { NpmVerifier } from "../src/verification/npm-verifier.js";
import { boundLog } from "../src/verification/log-bounds.js";

class ScriptedProvider implements SandboxProvider {
  public readonly commands: Command[] = [];
  private readonly responses: ExecutionResult[];

  public constructor(responses: ExecutionResult[]) {
    this.responses = [...responses];
  }

  public async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "fake-1" };
  }
  public async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}
  public async readFile(_handle: WorkspaceHandle, _path: string): Promise<Uint8Array> { return new Uint8Array(); }
  public async terminate(_handle: WorkspaceHandle): Promise<void> {}

  public async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No scripted response");
    return response;
  }
}

const handle = { providerId: "fake", providerWorkspaceId: "fake-1" };
const ok = (stdout = "", stderr = ""): ExecutionResult => ({ exitCode: 0, stdout, stderr });
const fail = (exitCode: number, stdout = "", stderr = ""): ExecutionResult => ({ exitCode, stdout, stderr });

function tickingClock(): () => number {
  let value = 0;
  return () => (value += 10);
}

test("npm verifier uses npm ci and runs optional test/build scripts", async () => {
  const provider = new ScriptedProvider([
    ok(JSON.stringify({ hasPackageLock: true, scripts: { test: "node test.js", build: "node build.js" } })),
    ok("installed"),
    ok("tests passed"),
    ok("built")
  ]);
  const result = await new NpmVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "PASSED");
  assert.deepEqual(result.steps.map((step) => step.name), ["install", "test", "build"]);
  assert.deepEqual(provider.commands[1]?.argv, ["npm", "ci", "--no-audit", "--no-fund"]);
  assert.deepEqual(provider.commands[2]?.argv, ["npm", "test"]);
  assert.deepEqual(provider.commands[3]?.argv, ["npm", "run", "build"]);
  assert.ok(result.durationMs > 0);
});

test("npm verifier falls back to npm install and skips missing scripts", async () => {
  const provider = new ScriptedProvider([
    ok(JSON.stringify({ hasPackageLock: false, scripts: {} })),
    ok("installed")
  ]);
  const result = await new NpmVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "PASSED");
  assert.equal(result.steps.length, 1);
  assert.deepEqual(provider.commands[1]?.argv, ["npm", "install", "--no-audit", "--no-fund"]);
});

test("npm verifier returns normalized failure details and stops after failure", async () => {
  const provider = new ScriptedProvider([
    ok(JSON.stringify({ hasPackageLock: true, scripts: { test: "node test.js", build: "node build.js" } })),
    ok("installed"),
    fail(7, "some output", "AssertionError: expected 2 to equal 3\nstack")
  ]);
  const result = await new NpmVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "FAILED");
  assert.equal(result.failedStep, "test");
  assert.equal(result.exitCode, 7);
  assert.match(result.failureSummary ?? "", /AssertionError/);
  assert.match(result.logExcerpt ?? "", /expected 2 to equal 3/);
  assert.equal(result.steps.length, 2);
  assert.equal(provider.commands.length, 3);
});

test("step logs are bounded", async () => {
  const provider = new ScriptedProvider([
    ok(JSON.stringify({ hasPackageLock: false, scripts: { test: "node test.js" } })),
    ok("installed"),
    fail(1, "x".repeat(1000), "y".repeat(1000))
  ]);
  const result = await new NpmVerifier(provider, {
    nowMs: tickingClock(),
    maxStepLogChars: 120,
    maxFailureExcerptChars: 160
  }).verify(handle);

  assert.equal(result.status, "FAILED");
  assert.ok((result.steps.at(-1)?.stdout.length ?? 0) <= 120);
  assert.ok((result.steps.at(-1)?.stderr.length ?? 0) <= 120);
  assert.ok((result.logExcerpt?.length ?? 0) <= 160);
  assert.match(result.steps.at(-1)?.stderr ?? "", /truncated/);
});

test("boundLog keeps short logs unchanged", () => {
  assert.equal(boundLog("short", 10), "short");
});
