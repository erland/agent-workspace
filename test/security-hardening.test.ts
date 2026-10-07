import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Command, CreateWorkspaceOptions, ExecutionResult, SandboxProvider, WorkspaceHandle } from "../src/core/sandbox-provider.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";
import { InMemoryWorkspaceRepository, InMemoryExecutionAccountRepository } from "../src/persistence/in-memory.js";
import { DEFAULT_SECURITY_POLICY } from "../src/security/security-policy.js";
import { redactSensitiveText } from "../src/security/redaction.js";
import { InMemoryFixedWindowRateLimiter } from "../src/security/rate-limiter.js";
import { normalizeToolError } from "../src/mcp/errors.js";
import { ExpiredWorkspaceCleanupJob } from "../src/workspace/expired-workspace-cleanup-job.js";
import type { ExecutionProviderFactory } from "../src/execution/execution-provider-factory.js";
import { makeStoredZip } from "./zip-fixture.js";

class FakeProvider implements SandboxProvider {
  creates: CreateWorkspaceOptions[] = [];
  terminated: WorkspaceHandle[] = [];
  failTerminate = false;
  async createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    this.creates.push(options);
    return { providerId: "fake", providerWorkspaceId: `sb-${this.creates.length}` };
  }
  async uploadArchive(): Promise<void> {}
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    if (command.argv[0] === "node" && command.argv[1] === "-e") {
      return { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: false, scripts: {} }), stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(): Promise<Uint8Array> { return new Uint8Array(); }
  async terminate(handle: WorkspaceHandle): Promise<void> {
    this.terminated.push(handle);
    if (this.failTerminate) throw new Error("provider unavailable");
  }
}

class FakeFactory implements ExecutionProviderFactory {
  constructor(private readonly provider: SandboxProvider) {}
  async createForAccount(): Promise<SandboxProvider> { return this.provider; }
}

describe("DEV-014 security hardening", () => {
  it("applies CPU, memory and outbound policy only when an execution sandbox is needed", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, { idFactory: () => "ws-policy", schedule: () => ({}) });
    await service.create();
    assert.equal(provider.creates.length, 0);

    await service.uploadZip("ws-policy", makeStoredZip([
      { path: "package.json", content: "{}" }
    ]));
    await service.verifyProject("ws-policy");

    const create = provider.creates[0];
    assert.equal(create?.cpu, DEFAULT_SECURITY_POLICY.workspaceCpu);
    assert.equal(create?.cpuLimit, DEFAULT_SECURITY_POLICY.workspaceCpuLimit);
    assert.equal(create?.memoryMiB, DEFAULT_SECURITY_POLICY.workspaceMemoryMiB);
    assert.deepEqual(create?.networkPolicy?.outboundDomainAllowlist, DEFAULT_SECURITY_POLICY.networkPolicy.outboundDomainAllowlist);
    assert.ok(create?.networkPolicy?.outboundDomainAllowlist?.includes("archive.ubuntu.com"));
    assert.ok(create?.networkPolicy?.outboundDomainAllowlist?.includes("security.ubuntu.com"));
    assert.deepEqual(create?.networkPolicy?.outboundCidrAllowlist, []);
    assert.equal(create?.encryptedPorts, undefined);
    assert.equal(provider.terminated.length, 1);
    assert.equal(DEFAULT_SECURITY_POLICY.maxWorkspaceLifetimeMinutes, 60);
  });

  it("enforces a maximum number of active workspaces per user", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      schedule: () => ({}),
      securityPolicy: { ...DEFAULT_SECURITY_POLICY, maxActiveWorkspacesPerUser: 1 }
    });
    await service.create();
    await assert.rejects(() => service.create(), /active workspace limit exceeded/);
    assert.equal(provider.creates.length, 0);
  });

  it("redacts bearer and provider credential material from errors/log text", () => {
    const text = "Authorization: Bearer abc.def.secret MODAL_TOKEN_SECRET=supersecret ov-abcdefghijkl";
    const safe = redactSensitiveText(text, ["supersecret"]);
    assert.ok(!safe.includes("abc.def.secret"));
    assert.ok(!safe.includes("supersecret"));
    assert.ok(!safe.includes("ov-abcdefghijkl"));
    const normalized = normalizeToolError(new Error("Authorization: Bearer top-secret"));
    assert.ok(!normalized.error.message.includes("top-secret"));
  });

  it("rate limits repeated operations in the same fixed window", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({ limitPerMinute: 2, nowMs: () => 1_000 });
    limiter.check("u1", "project_verify");
    limiter.check("u1", "project_verify");
    assert.throws(() => limiter.check("u1", "project_verify"), /Rate limit exceeded/);
  });


  it("cleanup also expires stale CREATING reservations", async () => {
    const provider = new FakeProvider();
    const workspaces = new InMemoryWorkspaceRepository();
    const accounts = new InMemoryExecutionAccountRepository();
    await accounts.upsert({ id: "ea1", userId: "u1", provider: "modal", credentialRef: "ref", status: "CONNECTED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    await workspaces.upsert({
      id: "ws-creating", userId: "u1", runtimeProfile: "java21-node22",
      status: "CREATING", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:01:00Z"
    });

    const job = new ExpiredWorkspaceCleanupJob(workspaces, () => new Date("2026-01-01T01:00:00Z"));
    const result = await job.run();

    assert.deepEqual(result, { processed: 1, failed: 0 });
    assert.equal(provider.terminated.length, 0);
    const persisted = await workspaces.findByIdForUser("ws-creating", "u1");
    assert.equal(persisted?.status, "EXPIRED");
  });
});
