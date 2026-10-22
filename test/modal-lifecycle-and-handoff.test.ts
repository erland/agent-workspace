import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxProvider, WorkspaceHandle, Command, ExecutionResult, CreateWorkspaceOptions } from "../src/core/sandbox-provider.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";
import { InMemoryArtifactRepository } from "../src/persistence/in-memory.js";
import { InMemoryObjectStore } from "../src/storage/in-memory-object-store.js";
import { makeStoredZip } from "./zip-fixture.js";

class LifecycleProvider implements SandboxProvider {
  readonly events: string[] = [];
  failures = 0;
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    this.events.push("create");
    return { providerId: "fake", providerWorkspaceId: "sandbox-test" };
  }
  async uploadArchive(): Promise<void> { this.events.push("upload"); }
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.events.push("exec");
    const cmd = command.argv.join(" ");
    if (command.argv[0] === "node" && command.argv[1] === "-e") {
      return { exitCode: 0, stdout: JSON.stringify({ lock: false, build: true }), stderr: "" };
    }
    if (cmd.includes("if [ -f") && cmd.includes("elif [ -d")) {
      return { exitCode: 0, stdout: "dir", stderr: "" };
    }
    if (command.argv[0] === "stat") return { exitCode: 0, stdout: "4", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  async readFile(): Promise<Uint8Array> {
    this.events.push("read");
    return new Uint8Array([1, 2, 3, 4]);
  }
  async terminate(): Promise<void> {
    this.events.push("terminate");
    if (this.failures-- > 0) throw new Error("provider termination failed");
  }
}

class RecordingStore extends InMemoryObjectStore {
  constructor(private readonly events: string[]) { super(); }
  override async put(key: string, bytes: Uint8Array) {
    this.events.push(key.startsWith("artifacts/") ? "publish" : "source");
    return super.put(key, bytes);
  }
}

async function setup(provider: LifecycleProvider) {
  const store = new RecordingStore(provider.events);
  const service = new WorkspaceService(provider, {
    userId: "test-user",
    idFactory: () => "ws_lifecycle",
    schedule: () => ({}),
    objectStore: store,
    artifactRepository: new InMemoryArtifactRepository()
  });
  await service.create();
  await service.uploadZip("ws_lifecycle", makeStoredZip([{
    path: "package.json",
    content: JSON.stringify({ name: "test", version: "1.0.0", scripts: { build: "echo built" } })
  }]));
  provider.events.length = 0;
  return { service, store };
}

describe("sandbox lifetime and artifact handoff", () => {
  it("terminates the sandbox before publishing artifacts, which remain readable afterwards", async () => {
    const provider = new LifecycleProvider();
    const { service } = await setup(provider);
    const result = await service.buildProject("ws_lifecycle", [{ path: "dist" }]);
    assert.equal(result.status, "PASSED");
    assert.equal(result.artifacts.length, 1);
    const terminated = provider.events.indexOf("terminate");
    const published = provider.events.indexOf("publish");
    assert.ok(terminated >= 0 && published > terminated, JSON.stringify(provider.events));
    const artifactId = result.artifacts[0]!.id;
    assert.equal((await service.getArtifact(artifactId)).id, artifactId);
    assert.deepEqual([...((await service.readArtifact(artifactId)).bytes)], [1, 2, 3, 4]);
  });

  it("retries a transient termination failure before publishing", async () => {
    const provider = new LifecycleProvider();
    provider.failures = 2;
    const { service } = await setup(provider);
    const result = await service.buildProject("ws_lifecycle", [{ path: "dist" }]);
    assert.equal(result.artifacts.length, 1);
    assert.equal(provider.events.filter(x => x === "terminate").length, 3);
    assert.ok(provider.events.indexOf("publish") > provider.events.lastIndexOf("terminate"));
  });

  it("fails visibly and never publishes if termination cannot be confirmed", async () => {
    const provider = new LifecycleProvider();
    provider.failures = 10;
    const { service } = await setup(provider);
    await assert.rejects(() => service.buildProject("ws_lifecycle", [{ path: "dist" }]),
      /Sandbox termination failed after 3 attempts/);
    assert.equal(provider.events.filter(x => x === "terminate").length, 3);
    assert.equal(provider.events.includes("publish"), false);
  });
});
