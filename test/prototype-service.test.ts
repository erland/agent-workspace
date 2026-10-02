import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import { PrototypeService } from "../src/prototype/prototype-service.js";

class ScriptedProvider implements SandboxProvider {
  public commands: Command[] = [];
  private readonly results: ExecutionResult[];

  constructor(results: ExecutionResult[]) {
    this.results = [...results];
  }

  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "fake" };
  }
  async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(_handle: WorkspaceHandle, _path: string): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(_handle: WorkspaceHandle): Promise<void> {}
}

const handle = { providerId: "fake", providerWorkspaceId: "fake" };

describe("PrototypeService", () => {
  it("installs with npm ci, starts Vite deterministically and waits for readiness", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" },
      { exitCode: 0, stdout: "installed", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "4321", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ]);

    const result = await new PrototypeService(provider, { nowMs: () => 1000 }).start(handle);

    assert.equal(result.status, "RUNNING");
    if (result.status !== "RUNNING") return;
    assert.equal(result.strategy, "dev");
    assert.equal(result.port, 4173);
    assert.equal(result.processId, 4321);
    assert.deepEqual(provider.commands[1]?.argv, ["npm", "ci", "--no-audit", "--no-fund"]);
    const launchText = provider.commands[3]?.argv.join(" ") ?? "";
    assert.match(launchText, /AGENT_WORKSPACE_START_B64/);
    assert.match(provider.commands[4]?.argv.join(" ") ?? "", /curl -fsS http:\/\/127\.0\.0\.1:4173/);
    const readinessScript = provider.commands[4]?.argv[2] ?? "";
    assert.match(readinessScript, /set -euo pipefail\nfor i in \$\(seq 1 /);
  });

  it("binds Vite publicly and allows the exact tunnel host when requested", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" },
      { exitCode: 0, stdout: "installed", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "4321", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ]);

    const result = await new PrototypeService(provider, {
      host: "0.0.0.0",
      allowedHost: "preview-example.modal.run"
    }).start(handle);

    assert.equal(result.status, "RUNNING");
    const launch = provider.commands[3]?.argv.join(" ") ?? "";
    const match = launch.match(/AGENT_WORKSPACE_START_B64='([^']+)'/);
    assert.ok(match?.[1]);
    const spec = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    assert.deepEqual(spec.argv, ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4173"]);
    assert.equal(spec.env.HOST, "0.0.0.0");
    assert.equal(spec.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, "preview-example.modal.run");
  });

  it("uses npm install without a lock file", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: false, scripts: { start: "node server.js" } }), stderr: "" },
      { exitCode: 1, stdout: "", stderr: "install failed" }
    ]);

    const result = await new PrototypeService(provider).start(handle);

    assert.equal(result.status, "FAILED");
    assert.deepEqual(provider.commands[1]?.argv, ["npm", "install", "--no-audit", "--no-fund"]);
    if (result.status === "FAILED") assert.equal(result.failedStep, "install");
  });

  it("returns a structured start failure when no supported script exists", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { build: "vite build" } }), stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ]);

    const result = await new PrototypeService(provider).start(handle);

    assert.equal(result.status, "FAILED");
    if (result.status === "FAILED") {
      assert.equal(result.failedStep, "start");
      assert.match(result.failureSummary, /No supported prototype start script/);
    }
  });

  it("cleans up the process and returns readiness failure when localhost never becomes ready", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "9876", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "Prototype readiness timed out" },
      { exitCode: 0, stdout: "", stderr: "" }
    ]);

    const result = await new PrototypeService(provider).start(handle);

    assert.equal(result.status, "FAILED");
    if (result.status === "FAILED") assert.equal(result.failedStep, "readiness");
    assert.match(provider.commands.at(-1)?.argv.join(" ") ?? "", /kill/);
  });

  it("builds before preview when preview is the selected strategy", async () => {
    const provider = new ScriptedProvider([
      { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { build: "vite build", preview: "vite preview" } }), stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "1234", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" }
    ]);

    const result = await new PrototypeService(provider).start(handle);

    assert.equal(result.status, "RUNNING");
    assert.deepEqual(provider.commands[2]?.argv, ["npm", "run", "build"]);
  });
});
