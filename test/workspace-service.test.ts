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
    assert.equal(workspace.expiresAt, "2026-09-29T12:20:00.000Z");
    assert.equal(provider.creates[0]?.imageRef, "ghcr.io/erland/agent-workspace-runtime:java21-node22-v2");
    assert.deepEqual(provider.creates[0]?.encryptedPorts, [4173]);
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
    assert.equal(provider.creates[0]?.imageRef, "ghcr.io/erland/agent-workspace-runtime:java25-node20-v2");
  });

  it("destroys a workspace and terminates the provider sandbox", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_destroy",
      schedule: () => ({})
    });

    await service.create();
    const destroyed = await service.destroy("ws_destroy");

    assert.equal(destroyed.status, "DESTROYED");
    assert.equal(provider.terminated.length, 1);
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
    assert.equal(provider.terminated.length, 1);
  });

  it("rejects lifetimes above the configured maximum", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, { schedule: () => ({}) });

    await assert.rejects(() => service.create({ lifetimeMinutes: 21 }), /may not exceed 20/);
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
    assert.equal(provider.creates.length, 1);
    assert.equal(provider.terminated.length, 0);
  });

  it("releases a pre-allocation reservation when provider creation fails", async () => {
    class FailOnceProvider extends FakeProvider {
      override async createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
        this.creates.push(options);
        if (this.creates.length === 1) throw new Error("provider create failed");
        return { providerId: "fake", providerWorkspaceId: "provider-retry" };
      }
    }

    const provider = new FailOnceProvider();
    const repository = new InMemoryWorkspaceRepository();
    let nextId = 0;
    const service = new WorkspaceService(provider, {
      userId: "user-provider-failure",
      repository,
      idFactory: () => `ws_provider_failure_${++nextId}`,
      schedule: () => ({}),
      securityPolicy: {
        ...DEFAULT_SECURITY_POLICY,
        maxActiveWorkspacesPerUser: 1
      }
    });

    await assert.rejects(() => service.create(), /provider create failed/);
    assert.equal(
      await repository.findByIdForUser("ws_provider_failure_1", "user-provider-failure"),
      undefined
    );

    const retried = await service.create();
    assert.equal(retried.status, "READY");
    assert.equal(retried.id, "ws_provider_failure_2");
    assert.equal(provider.creates.length, 2);
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
    assert.equal(provider.terminated.length, 1);
    const persisted = await repository.findByIdForUser("ws_persist_failure", "user-persist-failure");
    assert.equal(persisted?.status, "DESTROYED");
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

    assert.equal(provider.uploads.length, 1);
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

describe("WorkspaceService prototype start", () => {
  it("starts an uploaded npm prototype and records RUNNING state", async () => {
    class PrototypeProvider extends FakeProvider {
      private call = 0;
      override async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
        this.commands.push(command);
        this.call += 1;
        // Runtime toolchain is prebuilt, so the first exec is prototype inspection.
        if (this.call === 1) {
          return { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" };
        }
        if (this.call === 4) return { exitCode: 0, stdout: "2468", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }

    const provider = new PrototypeProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_prototype",
      schedule: () => ({})
    });
    await service.create();
    await service.uploadZip("ws_prototype", makeStoredZip([
      { path: "package.json", content: JSON.stringify({ scripts: { dev: "vite" } }) }
    ]));

    const result = await service.startPrototype("ws_prototype");
    const workspace = await service.get("ws_prototype");

    assert.equal(result.status, "RUNNING");
    assert.equal(workspace.prototype?.status, "RUNNING");
    assert.equal(workspace.prototype?.port, 4173);
  });

  it("returns the encrypted tunnel URL for a running prototype", async () => {
    class PreviewProvider extends FakeProvider {
      private call = 0;
      override async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
        this.commands.push(command);
        this.call += 1;
        if (this.call === 1) {
          return { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" };
        }
        if (this.call === 4) return { exitCode: 0, stdout: "2468", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      async getTunnelUrl(_handle: WorkspaceHandle, port: number): Promise<string> {
        assert.equal(port, 4173);
        return "https://preview-example.modal.run";
      }
    }

    const provider = new PreviewProvider();
    const now = new Date("2026-09-29T12:00:00.000Z");
    const service = new WorkspaceService(provider, {
      now: () => now,
      idFactory: () => "ws_preview",
      schedule: () => ({})
    });
    await service.create();
    await service.uploadZip("ws_preview", makeStoredZip([
      { path: "package.json", content: JSON.stringify({ scripts: { dev: "vite" } }) }
    ]));

    const started = await service.startPrototype("ws_preview");
    assert.equal(started.status, "RUNNING");
    const link = await service.prototypePreviewLink("ws_preview");

    assert.deepEqual(link, {
      status: "AVAILABLE",
      url: "https://preview-example.modal.run",
      expiresAt: "2026-09-29T12:20:00.000Z",
      access: "temporary-public",
      port: 4173
    });

    const launchText = provider.commands[3]?.argv.join(" ") ?? "";
    const match = launchText.match(/AGENT_WORKSPACE_START_B64='([^']+)'/);
    assert.ok(match?.[1]);
    const spec = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    assert.equal(spec.env.HOST, "0.0.0.0");
    assert.equal(spec.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, "preview-example.modal.run");
  });

  it("rejects prototype start for a Maven project", async () => {
    const provider = new FakeProvider();
    const service = new WorkspaceService(provider, {
      idFactory: () => "ws_maven_proto",
      schedule: () => ({})
    });
    await service.create();
    await service.uploadZip("ws_maven_proto", makeStoredZip([
      { path: "pom.xml", content: "<project><modelVersion>4.0.0</modelVersion></project>" }
    ]));

    await assert.rejects(() => service.startPrototype("ws_maven_proto"), /project is not npm/);
  });
});
