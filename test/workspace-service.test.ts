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
    assert.equal(workspace.expiresAt, "2026-09-29T12:30:00.000Z");
    assert.equal(provider.creates[0]?.imageRef, "eclipse-temurin:21-jdk-noble");
    assert.equal(provider.commands.length, 1);
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
    assert.equal(provider.creates[0]?.imageRef, "eclipse-temurin:25-jdk-noble");
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

    await assert.rejects(() => service.create({ lifetimeMinutes: 61 }), /may not exceed 60/);
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
        // create runtime bootstrap is call 1
        if (this.call === 2) {
          return { exitCode: 0, stdout: JSON.stringify({ hasPackageLock: true, scripts: { dev: "vite" } }), stderr: "" };
        }
        if (this.call === 5) return { exitCode: 0, stdout: "2468", stderr: "" };
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
