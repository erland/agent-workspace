import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, Command, ExecutionResult } from "../src/core/sandbox-provider.js";
import { StaticProfileProvider } from "../src/mcp/profile.js";
import { AgentWorkspaceToolService } from "../src/mcp/tool-service.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";
import { makeStoredZip } from "./zip-fixture.js";

class FakeProvider implements SandboxProvider {
  public terminated = false;
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> { return { providerId: "fake", providerWorkspaceId: "p1" }; }
  async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    if (command.argv[0] === "node" && command.argv[1] === "-e") return { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: false, scripts: {} }), stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(): Promise<void> { this.terminated = true; }
}

describe("DEV-010 MCP tool service contract", () => {
  it("exposes capabilities and profile without Modal-specific credentials", async () => {
    const provider = new FakeProvider();
    const workspace = new WorkspaceService(provider, { idFactory: () => "ws_1", schedule: () => ({}) });
    const tools = new AgentWorkspaceToolService(workspace, new StaticProfileProvider({ user: { id: "u1", displayName: "Test" }, execution: { provider: "modal", connected: true } }));
    const caps = await tools.getCapabilities();
    const profile = await tools.getProfile();
    assert.equal(caps.ok, true);
    assert.deepEqual(profile, { ok: true, result: { user: { id: "u1", displayName: "Test" }, execution: { provider: "modal", connected: true } } });
    assert.equal(JSON.stringify(profile).includes("token"), false);
  });

  it("creates and destroys a workspace through provider-neutral tools", async () => {
    const provider = new FakeProvider();
    const workspace = new WorkspaceService(provider, { idFactory: () => "ws_1", schedule: () => ({}) });
    const tools = new AgentWorkspaceToolService(workspace, new StaticProfileProvider({ user: { id: "u1" }, execution: { provider: "modal", connected: true } }));
    const created = await tools.createWorkspace({ java: "21", node: "22" });
    assert.equal(created.ok, true);
    const destroyed = await tools.destroyWorkspace({ workspaceId: "ws_1" });
    assert.equal(destroyed.ok, true);
    assert.equal(provider.terminated, true);
  });

  it("uploads base64 ZIP and project_verify selects npm", async () => {
    const provider = new FakeProvider();
    const workspace = new WorkspaceService(provider, { idFactory: () => "ws_1", schedule: () => ({}) });
    const tools = new AgentWorkspaceToolService(workspace, new StaticProfileProvider({ user: { id: "u1" }, execution: { provider: "modal", connected: true } }));
    await tools.createWorkspace({});
    const zip = makeStoredZip([{ path: "package.json", content: JSON.stringify({ name: "x", version: "1.0.0" }) }]);
    const upload = await tools.uploadZip({ workspaceId: "ws_1", archiveBase64: Buffer.from(zip).toString("base64") });
    assert.equal(upload.ok, true);
    const verified = await tools.verifyProject({ workspaceId: "ws_1" });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal((verified.result as any).projectType, "NPM");
  });

  it("returns standardized error for unknown workspace", async () => {
    const tools = new AgentWorkspaceToolService(new WorkspaceService(new FakeProvider()), new StaticProfileProvider({ user: { id: "u1" }, execution: { provider: "modal", connected: true } }));
    const result = await tools.destroyWorkspace({ workspaceId: "missing" });
    assert.deepEqual(result, { ok: false, error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found: missing", retryable: false } });
  });
});
