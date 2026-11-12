import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthenticatedAgentWorkspaceToolService } from "../src/auth/authenticated-tool-service.js";
import type { SandboxProvider, CreateWorkspaceOptions, Command, ExecutionResult, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import type { ExecutionProviderFactory } from "../src/execution/execution-provider-factory.js";
import { InMemoryObjectStore } from "../src/storage/in-memory-object-store.js";
import { IdentityService } from "../src/persistence/identity-service.js";
import {
  InMemoryArtifactRepository,
  InMemoryExecutionAccountRepository,
  InMemoryExternalIdentityRepository,
  InMemoryUserRepository,
  InMemoryWorkspaceRepository
} from "../src/persistence/in-memory.js";

class FakeProvider implements SandboxProvider {
  private sequence = 0;
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    this.sequence += 1;
    return { providerId: "fake", providerWorkspaceId: `sandbox-${this.sequence}` };
  }
  async exec(_workspace: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    return { exitCode: 0, stdout: command.argv[0] === "java" ? "openjdk 21" : "", stderr: "" };
  }
  async uploadArchive(): Promise<void> {}
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(): Promise<void> {}
}

class FakeFactory implements ExecutionProviderFactory {
  constructor(private readonly provider: SandboxProvider) {}
  async createForAccount(): Promise<SandboxProvider> { return this.provider; }
}

function setup() {
  const users = new InMemoryUserRepository();
  const identities = new InMemoryExternalIdentityRepository();
  const accounts = new InMemoryExecutionAccountRepository();
  const workspaces = new InMemoryWorkspaceRepository();
  const artifacts = new InMemoryArtifactRepository();
  const objectStore = new InMemoryObjectStore();
  let userNo = 0;
  const identityService = new IdentityService(users, identities, accounts, {
    idFactory: (kind) => kind === "user" ? `usr-${++userNo}` : `idn-${userNo}`
  });
  const provider = new FakeProvider();
  const deps = { identityService, users, executionAccounts: accounts, workspaces, artifacts, objectStore, providerFactory: new FakeFactory(provider) };
  return { deps, accounts, workspaces };
}

describe("authenticated MCP tool isolation", () => {
  it("resolves one persisted Agent Workspace user per issuer+subject", async () => {
    const { deps } = setup();
    const a = new AuthenticatedAgentWorkspaceToolService({ issuer: "issuer", subject: "alice", scopes: ["agent-workspace"] }, deps);
    const p1 = await a.getProfile();
    const p2 = await a.getProfile();
    assert.equal(p1.ok, true);
    assert.deepEqual(p1, p2);
  });

  it("denies execution until that user has a connected execution account", async () => {
    const { deps } = setup();
    const a = new AuthenticatedAgentWorkspaceToolService({ issuer: "issuer", subject: "alice", scopes: ["agent-workspace"] }, deps);
    const result = await a.createWorkspace({});
    assert.equal(result.ok, false);
    if (result.ok === false) assert.match(result.error.message, /Execution account is not connected/);
  });

  it("forwards Playwright selection through authenticated workspace creation", async () => {
    const { deps, accounts } = setup();
    const service = new AuthenticatedAgentWorkspaceToolService({ issuer: "issuer", subject: "alice", scopes: ["agent-workspace"] }, deps);
    const profile = await service.getProfile();
    assert.equal(profile.ok, true);
    const userId = (profile as any).result.user.id as string;
    await accounts.upsert({ id: "acct-pw", userId, provider: "modal", credentialRef: "fake:pw", status: "CONNECTED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const created = await service.createWorkspace({ playwright: true });
    assert.equal(created.ok, true);
    if (created.ok) assert.equal((created.result as any).runtimeProfile, "playwright-chromium-node22");
    const invalid = await service.createWorkspace({ playwright: true, java: "25" });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.match(invalid.error.message, /requires Java 21 and Node 22/);
  });

  it("forwards Rust and Tauri through the authenticated production MCP path", async () => {
    const { deps, accounts, workspaces } = setup();
    const service = new AuthenticatedAgentWorkspaceToolService(
      { issuer: "issuer", subject: "rust-tauri-user", scopes: ["agent-workspace"] }, deps
    );
    const profile = await service.getProfile();
    assert.equal(profile.ok, true);
    const userId = (profile as any).result.user.id as string;
    await accounts.upsert({
      id: "acct-cargo", userId, provider: "modal", credentialRef: "fake:cargo",
      status: "CONNECTED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    for (const [input, expected] of [
      [{ rust: true, lifetimeMinutes: 5 }, "rust"],
      [{ tauri: true, lifetimeMinutes: 5 }, "tauri-linux"],
      [{}, "java21-node22"]
    ] as const) {
      const created = await service.createWorkspace(input);
      assert.equal(created.ok, true);
      if (!created.ok) continue;
      const workspace = created.result as { id: string; runtimeProfile: string };
      assert.equal(workspace.runtimeProfile, expected);
      const persisted = await workspaces.findByIdForUser(workspace.id, userId);
      assert.equal(persisted?.runtimeProfile, expected);
      const destroyed = await service.destroyWorkspace({ workspaceId: workspace.id });
      assert.equal(destroyed.ok, true);
    }
    for (const input of [
      { rust: true, java: "21" as const },
      { rust: true, node: "22" as const },
      { rust: true, playwright: true },
      { tauri: true, rust: true }
    ]) {
      const response = await service.createWorkspace(input);
      assert.equal(response.ok, false, "incompatible options must be rejected");
    }
  });

  it("forwards Go selection and rejects incompatible runtime choices in authenticated MCP", async () => {
    const { deps, accounts, workspaces } = setup();
    const service = new AuthenticatedAgentWorkspaceToolService(
      { issuer: "issuer", subject: "go-user", scopes: ["agent-workspace"] }, deps
    );
    const profile = await service.getProfile();
    assert.equal(profile.ok, true);
    const userId = (profile as any).result.user.id as string;
    await accounts.upsert({
      id: "acct-go", userId, provider: "modal", credentialRef: "fake:go",
      status: "CONNECTED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });

    const created = await service.createWorkspace({ go: true, lifetimeMinutes: 5 });
    assert.equal(created.ok, true);
    if (created.ok) {
      const workspace = created.result as { id: string; runtimeProfile: string };
      assert.equal(workspace.runtimeProfile, "go");
      const persisted = await workspaces.findByIdForUser(workspace.id, userId);
      assert.equal(persisted?.runtimeProfile, "go");
      const destroyed = await service.destroyWorkspace({ workspaceId: workspace.id });
      assert.equal(destroyed.ok, true);
    }

    for (const input of [
      { go: true, rust: true },
      { go: true, java: "17" as const },
      { go: true, node: "22" as const },
      { go: true, playwright: true },
      { go: true, tauri: true }
    ]) {
      const result = await service.createWorkspace(input);
      assert.equal(result.ok, false, "Go cannot be silently ignored when combined with incompatible runtimes");
      if (!result.ok) assert.match(result.error.message, /Go runtime cannot be combined/);
    }
  });

  it("cannot access another authenticated user's workspace", async () => {
    const { deps, accounts } = setup();
    const alice = new AuthenticatedAgentWorkspaceToolService({ issuer: "issuer", subject: "alice", scopes: ["agent-workspace"] }, deps);
    const aliceProfile = await alice.getProfile();
    assert.equal(aliceProfile.ok, true);
    const aliceId = (aliceProfile as any).result.user.id as string;
    await accounts.upsert({ id: "acct-a", userId: aliceId, provider: "modal", credentialRef: "fake:a", status: "CONNECTED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const created = await alice.createWorkspace({});
    assert.equal(created.ok, true);
    const workspaceId = (created as any).result.id as string;

    const bob = new AuthenticatedAgentWorkspaceToolService({ issuer: "issuer", subject: "bob", scopes: ["agent-workspace"] }, deps);
    const bobProfile = await bob.getProfile();
    assert.equal(bobProfile.ok, true);
    const bobId = (bobProfile as any).result.user.id as string;
    await accounts.upsert({ id: "acct-b", userId: bobId, provider: "modal", credentialRef: "fake:b", status: "CONNECTED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const result = await bob.destroyWorkspace({ workspaceId });
    assert.equal(result.ok, false);
    if (result.ok === false) assert.match(result.error.message, /Workspace not found/);
  });
});
