import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthenticatedAgentWorkspaceToolService } from "../src/auth/authenticated-tool-service.js";
import type { SandboxProvider, CreateWorkspaceOptions, Command, ExecutionResult, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import type { ExecutionProviderFactory } from "../src/execution/execution-provider-factory.js";
import { IdentityService } from "../src/persistence/identity-service.js";
import {
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
  let userNo = 0;
  const identityService = new IdentityService(users, identities, accounts, {
    idFactory: (kind) => kind === "user" ? `usr-${++userNo}` : `idn-${userNo}`
  });
  const provider = new FakeProvider();
  const deps = { identityService, users, executionAccounts: accounts, workspaces, providerFactory: new FakeFactory(provider) };
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
