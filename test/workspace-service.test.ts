import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";
import { InMemoryWorkspaceRepository } from "../src/persistence/in-memory.js";
import { DEFAULT_SECURITY_POLICY } from "../src/security/security-policy.js";

class FakeProvider implements SandboxProvider {
  public creates: CreateWorkspaceOptions[] = [];
  public commands: Command[] = [];
  public terminated: WorkspaceHandle[] = [];

  async createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    this.creates.push(options);
    return { providerId: "fake", providerWorkspaceId: `provider-${this.creates.length}` };
  }

  async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}

  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async readFile(_handle: WorkspaceHandle, _path: string): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async terminate(handle: WorkspaceHandle): Promise<void> {
    this.terminated.push(handle);
  }
}

describe("WorkspaceService", () => {
  it("creates a READY workspace using the default runtime and TTL", async () => {
    const provider = new FakeProvider();
    const now = new Date("2026-09-29T12:00:00.000Z");
    const service = new WorkspaceService(provider, {
      now: () => now,
      idFactory: () => "ws_test",
      schedule: () => ({})
    });

    const workspace = await service.create();

    assert.equal(workspace.id, "ws_test");
    assert.equal(workspace.status, "READY");
    assert.equal(workspace.runtimeProfile, "java21-node22");
    assert.equal(workspace.expiresAt, "2026-09-29T13:00:00.000Z");
    assert.equal(provider.creates.length, 0);
    assert.equal(provider.commands.length, 0);
  });

  it("supports an explicit runtime and lifetime", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      now: () => new Date("2026-09-29T12:00:00.000Z"),
      idFactory: () => "ws_explicit",
      schedule: () => ({})
    });

    const workspace = await service.create({
      runtime: { java: "25", node: "20" },
      lifetimeMinutes: 10
    });

    assert.equal(workspace.runtimeProfile, "java25-node20");
    assert.equal(workspace.expiresAt, "2026-09-29T12:10:00.000Z");
    assert.equal(provider.creates.length, 0);
  });

  it("destroys a logical workspace without allocating a provider sandbox", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_destroy",
      schedule: () => ({})
    });

    await service.create();
    const destroyed = await service.destroy("ws_destroy");

    assert.equal(destroyed.status, "DESTROYED");
    assert.equal(provider.terminated.length, 0);
  });

  it("expires a workspace when its TTL has elapsed", async () => {
    const provider = new FakeProvider();
    let now = new Date("2026-09-29T12:00:00.000Z");
    const service = new WorkspaceService(provider, {
      now: () => now,
      idFactory: () => "ws_expire",
      schedule: () => ({})
    });

    await service.create({ lifetimeMinutes: 1 });
    now = new Date("2026-09-29T12:01:01.000Z");

    const expired = await service.get("ws_expire");

    assert.equal(expired.status, "EXPIRED");
    assert.equal(provider.terminated.length, 0);
  });

  it("rejects lifetimes above the configured maximum", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, { schedule: () => ({}) });

    await assert.rejects(() => service.create({ lifetimeMinutes: 61 }), /may not exceed 60/);
  });


  it("enforces the active workspace quota atomically for concurrent creates", async () => {
    const provider = new FakeProvider();
    const repository = new InMemoryWorkspaceRepository();
    let nextId = 0;
    const service = new WorkspaceService(provider, {
      userId: "user-concurrent",
      repository,
      idFactory: () => `ws_concurrent_${++nextId}`,
      schedule: () => ({}),
      securityPolicy: {
        ...DEFAULT_SECURITY_POLICY,
        maxActiveWorkspacesPerUser: 1
      }
    });

    const results = await Promise.allSettled([service.create(), service.create()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String((rejected[0] as PromiseRejectedResult).reason), /active workspace limit exceeded/);
    assert.equal(provider.creates.length, 0);
    assert.equal(provider.terminated.length, 0);
  });

  it("does not allocate an execution provider during logical workspace creation", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_lazy",
      schedule: () => ({})
    });

    const workspace = await service.create();

    assert.equal(workspace.status, "READY");
    assert.equal(provider.creates.length, 0);
  });

  it("terminates and marks a reserved workspace destroyed when READY persistence fails", async () => {
    class FailingReadyRepository extends InMemoryWorkspaceRepository {
      override async upsert(workspace: Parameters<InMemoryWorkspaceRepository["upsert"]>[0]): Promise<void> {
        if (workspace.status === "READY") throw new Error("database unavailable");
        return super.upsert(workspace);
      }
    }

    const provider = new FakeProvider();
    const repository = new FailingReadyRepository();
    const service = new WorkspaceService(provider, {
      userId: "user-persist-failure",
      repository,
      idFactory: () => "ws_persist_failure",
      schedule: () => ({})
    });

    await assert.rejects(() => service.create(), /database unavailable/);
    assert.equal(provider.terminated.length, 0);
    const persisted = await repository.findByIdForUser("ws_persist_failure", "user-persist-failure");
    assert.equal(persisted, undefined);
  });
});

import { ArchiveValidationError } from "../src/archive/archive-validator.js";
import { makeStoredZip } from "./zip-fixture.js";

describe("WorkspaceService ZIP upload", () => {
  it("validates an archive before sending it to the provider", async () => {
    class UploadProvider extends FakeProvider {
      public uploads: Uint8Array[] = [];
      override async uploadArchive(_handle: WorkspaceHandle, archive: Uint8Array): Promise<void> {
        this.uploads.push(archive);
      }
    }

    const provider = new UploadProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_upload",
      schedule: () => ({})
    });
    await service.create();
    const archive = makeStoredZip([{ path: "package.json", content: "{}" }]);

    const result = await service.uploadZip("ws_upload", archive);

    assert.equal(provider.uploads.length, 0);
    assert.equal(result.validation.entryCount, 1);
    assert.equal(result.workspace.project?.archive.entryCount, 1);
    assert.equal(result.workspace.project?.analysis.projectType, "NPM");
    assert.deepEqual(result.workspace.project?.analysis.recommendedRuntime, { java: "21", node: "22" });
  });

  it("verifies an npm project inside a ZIP top-level directory", async () => {
    class NestedNpmProvider extends FakeProvider {
      override async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
        this.commands.push(command);
        if (command.argv[0] === "node" && command.argv[1] === "-e") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ hasPackageLock: false, scripts: {} }),
            stderr: ""
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }

    const provider = new NestedNpmProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_nested_npm",
      schedule: () => ({})
    });
    await service.create();
    await service.uploadZip("ws_nested_npm", makeStoredZip([
      { path: "prototype/package.json", content: "{}" },
      { path: "prototype/src/main.ts", content: "console.log('ok');" }
    ]));

    const result = await service.verifyProject("ws_nested_npm");

    assert.equal(result.status, "PASSED");
    assert.equal(provider.creates.length, 1);
    assert.equal(provider.terminated.length, 1);
    const verificationCommands = provider.commands.filter((command) => command.workdir !== undefined);
    assert.ok(verificationCommands.length >= 2);
    for (const command of verificationCommands) {
      assert.equal(command.workdir, "/workspace/project/prototype");
    }
  });

  it("does not send an invalid archive to the provider", async () => {
    class UploadProvider extends FakeProvider {
      public uploads = 0;
      override async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {
        this.uploads += 1;
      }
    }

    const provider = new UploadProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_bad_upload",
      schedule: () => ({})
    });
    await service.create();

    await assert.rejects(
      () => service.uploadZip("ws_bad_upload", makeStoredZip([{ path: "../bad", content: "x" }])),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "ILLEGAL_PATH"
    );
    assert.equal(provider.uploads, 0);
  });
});
