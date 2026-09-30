import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Command, CreateWorkspaceOptions, ExecutionResult, SandboxProvider, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import { InMemoryWorkspaceRepository } from "../src/persistence/in-memory.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";

class FakeProvider implements SandboxProvider {
  terminated: WorkspaceHandle[] = [];
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "provider-1" };
  }
  async uploadArchive(): Promise<void> {}
  async exec(_handle: WorkspaceHandle, _command: Command): Promise<ExecutionResult> {
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(handle: WorkspaceHandle): Promise<void> { this.terminated.push(handle); }
}

describe("WorkspaceService persistence", () => {
  it("rehydrates workspace metadata after service restart", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const provider = new FakeProvider();
    const first = new WorkspaceService(provider, {
      userId: "user-1", repository, idFactory: () => "ws-persisted", schedule: () => ({})
    });
    await first.create();

    const restarted = new WorkspaceService(provider, {
      userId: "user-1", repository, schedule: () => ({})
    });
    const workspace = await restarted.get("ws-persisted");

    assert.equal(workspace.userId, "user-1");
    assert.equal(workspace.providerWorkspaceId, "provider-1");
    assert.equal(workspace.status, "READY");
  });

  it("does not allow another user to load a persisted workspace", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const provider = new FakeProvider();
    const owner = new WorkspaceService(provider, {
      userId: "user-1", repository, idFactory: () => "ws-owned", schedule: () => ({})
    });
    await owner.create();

    const other = new WorkspaceService(provider, {
      userId: "user-2", repository, schedule: () => ({})
    });
    await assert.rejects(() => other.get("ws-owned"), /Workspace not found/);
  });

  it("persists destroyed state", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      userId: "user-1", repository, idFactory: () => "ws-destroyed", schedule: () => ({})
    });
    await service.create();
    await service.destroy("ws-destroyed");

    const stored = await repository.findByIdForUser("ws-destroyed", "user-1");
    assert.equal(stored?.status, "DESTROYED");
    assert.equal(provider.terminated.length, 1);
  });

  it("reconciles an expired persisted workspace after restart", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const provider = new FakeProvider();
    await repository.upsert({
      id: "ws-expired-db", userId: "user-1", providerId: "fake", providerWorkspaceId: "provider-expired",
      runtimeProfile: "java21-node22", status: "READY",
      createdAt: "2026-09-29T17:00:00.000Z", expiresAt: "2026-09-29T17:30:00.000Z"
    });
    const service = new WorkspaceService(provider, {
      userId: "user-1", repository, now: () => new Date("2026-09-29T18:00:00.000Z"), schedule: () => ({})
    });

    const cleaned = await service.cleanupExpired();
    const stored = await repository.findByIdForUser("ws-expired-db", "user-1");

    assert.equal(cleaned, 1);
    assert.equal(provider.terminated[0]?.providerWorkspaceId, "provider-expired");
    assert.equal(stored?.status, "EXPIRED");
  });

});
