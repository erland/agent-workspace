import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle,
  Command
} from "../src/core/sandbox-provider.js";

class FakeSandboxProvider implements SandboxProvider {
  public terminated = false;
  public uploaded = false;

  public async createWorkspace(
    _options: CreateWorkspaceOptions
  ): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "fake-1" };
  }

  public async uploadArchive(
    _handle: WorkspaceHandle,
    _archive: Uint8Array
  ): Promise<void> {
    this.uploaded = true;
  }

  public async exec(
    _handle: WorkspaceHandle,
    _command: Command
  ): Promise<ExecutionResult> {
    return { exitCode: 0, stdout: "v22.0.0\n", stderr: "" };
  }

  public async readFile(_handle: WorkspaceHandle, _path: string): Promise<Uint8Array> {
    return new Uint8Array();
  }

  public async terminate(_handle: WorkspaceHandle): Promise<void> {
    this.terminated = true;
  }
}

describe("SandboxProvider contract", () => {
  it("supports provider-neutral create/upload/exec/terminate flow", async () => {
    const fake = new FakeSandboxProvider();
    const provider: SandboxProvider = fake;
    const handle = await provider.createWorkspace({ imageRef: "unused" });
    await provider.uploadArchive(handle, new Uint8Array([1, 2, 3]));
    const result = await provider.exec(handle, { argv: ["node", "--version"] });

    assert.equal(handle.providerWorkspaceId, "fake-1");
    assert.equal(fake.uploaded, true);
    assert.deepEqual(result, {
      exitCode: 0,
      stdout: "v22.0.0\n",
      stderr: ""
    });

    await provider.terminate(handle);
    assert.equal(fake.terminated, true);
  });
});
