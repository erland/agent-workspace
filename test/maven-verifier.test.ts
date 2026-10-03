import assert from "node:assert/strict";
import test from "node:test";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import { MavenVerifier } from "../src/verification/maven-verifier.js";

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

test("Maven verifier prefers mvnw and stops after compile/test verification", async () => {
  const provider = new ScriptedProvider([
    ok("./mvnw"),
    ok("tests passed")
  ]);
  const result = await new MavenVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "PASSED");
  assert.equal(result.projectType, "MAVEN");
  assert.deepEqual(result.steps.map((step) => step.name), ["test"]);
  assert.deepEqual(provider.commands[1]?.argv, ["./mvnw", "test"]);
  assert.equal(provider.commands.length, 2);
  assert.ok(result.durationMs > 0);
});

test("Maven verifier falls back to system mvn", async () => {
  const provider = new ScriptedProvider([
    ok("mvn"),
    ok("tests passed")
  ]);
  const result = await new MavenVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "PASSED");
  assert.deepEqual(provider.commands[1]?.argv, ["mvn", "test"]);
  assert.equal(provider.commands.length, 2);
});

test("Maven verifier normalizes test failure", async () => {
  const provider = new ScriptedProvider([
    ok("mvn"),
    fail(1, "", "[ERROR] Tests run: 1, Failures: 1\nAssertionError: expected 2 but was 3")
  ]);
  const result = await new MavenVerifier(provider, { nowMs: tickingClock() }).verify(handle);

  assert.equal(result.status, "FAILED");
  assert.equal(result.failedStep, "test");
  assert.equal(result.exitCode, 1);
  assert.match(result.failureSummary ?? "", /Tests run/);
  assert.match(result.logExcerpt ?? "", /AssertionError/);
  assert.equal(result.steps.length, 1);
  assert.equal(provider.commands.length, 2);
});

test("Maven verifier bounds step logs and failure excerpt", async () => {
  const provider = new ScriptedProvider([
    ok("mvn"),
    fail(1, "x".repeat(1000), "y".repeat(1000))
  ]);
  const result = await new MavenVerifier(provider, {
    nowMs: tickingClock(),
    maxStepLogChars: 120,
    maxFailureExcerptChars: 160
  }).verify(handle);

  assert.equal(result.status, "FAILED");
  assert.ok((result.steps[0]?.stdout.length ?? 0) <= 120);
  assert.ok((result.steps[0]?.stderr.length ?? 0) <= 120);
  assert.ok((result.logExcerpt?.length ?? 0) <= 160);
  assert.match(result.steps[0]?.stderr ?? "", /truncated/);
});
