import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import { ProjectBuildService } from "../src/artifact/project-build-service.js";

class BuildProvider implements SandboxProvider {
  public readonly commands: Command[] = [];
  public readonly reads: string[] = [];

  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
    return { providerId: "fake", providerWorkspaceId: "sb-1" };
  }
  async uploadArchive(): Promise<void> {}
  async terminate(): Promise<void> {}

  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> {
    this.commands.push(command);
    const text = command.argv.join(" ");
    if (command.argv[0] === "node" && command.argv[1] === "-e") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ lock: true, build: true }),
        stderr: ""
      };
    }
    if (text.includes("for p in dist build out")) {
      return { exitCode: 0, stdout: "dist\n", stderr: "" };
    }
    if (text.includes("if [ -f") && text.includes("elif [ -d")) {
      return { exitCode: 0, stdout: text.includes("dist/app.zip") ? "file" : "dir", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async readFile(_handle: WorkspaceHandle, path: string): Promise<Uint8Array> {
    this.reads.push(path);
    return new Uint8Array([1, 2, 3, 4]);
  }
}

const handle = { providerId: "fake", providerWorkspaceId: "sb-1" };

describe("ProjectBuildService", () => {
  it("builds npm and packages a detected static directory as a generic artifact", async () => {
    const provider = new BuildProvider();
    const result = await new ProjectBuildService(provider, "/workspace/project").build(
      handle,
      "NPM"
    );

    assert.equal(result.status, "PASSED");
    assert.equal(result.projectType, "NPM");
    assert.equal(result.outputs.length, 1);
    assert.equal(result.outputs[0]?.name, "dist");
    assert.equal(result.outputs[0]?.kind, "static-web");
    assert.equal(result.outputs[0]?.filename, "dist.tar.gz");
    assert.equal(result.outputs[0]?.mediaType, "application/gzip");
    assert.deepEqual([...result.outputs[0]!.bytes], [1, 2, 3, 4]);
    assert.ok(provider.commands.some((command) =>
      command.argv.join(" ") === "npm ci --no-audit --no-fund"
    ));
    assert.ok(provider.commands.some((command) =>
      command.argv.join(" ") === "npm run build"
    ));
    assert.deepEqual(provider.reads, ["/tmp/agent-workspace-build-0.tar.gz"]);
  });

  it("collects an explicitly requested file without repackaging it", async () => {
    const provider = new BuildProvider();
    const result = await new ProjectBuildService(provider, "/workspace/project").build(
      handle,
      "NPM",
      [{ path: "dist/app.zip", name: "deploy", kind: "zip" }]
    );

    assert.equal(result.outputs.length, 1);
    assert.equal(result.outputs[0]?.filename, "app.zip");
    assert.equal(result.outputs[0]?.kind, "zip");
    assert.equal(result.outputs[0]?.mediaType, "application/zip");
    assert.deepEqual(provider.reads, ["/workspace/project/dist/app.zip"]);
  });

  it("rejects requested outputs that can escape the project root", async () => {
    const provider = new BuildProvider();
    await assert.rejects(
      () => new ProjectBuildService(provider, "/workspace/project").build(
        handle,
        "NPM",
        [{ path: "../secret" }]
      ),
      /Invalid build output path/
    );
  });
});
