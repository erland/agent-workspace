import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../src/core/sandbox-provider.js";
import {
  ScreenshotService,
  VIEWPORT_PRESETS,
  resolveViewport
} from "../src/prototype/screenshot-service.js";

const PNG = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);

class ScreenshotProvider implements SandboxProvider {
  public commands: Command[] = [];
  public readPaths: string[] = [];
  constructor(private readonly result: ExecutionResult, private readonly bytes: Uint8Array = PNG) {}
  async createWorkspace(_options: CreateWorkspaceOptions): Promise<WorkspaceHandle> { return { providerId:"fake", providerWorkspaceId:"fake" }; }
  async uploadArchive(_handle: WorkspaceHandle, _archive: Uint8Array): Promise<void> {}
  async exec(_handle: WorkspaceHandle, command: Command): Promise<ExecutionResult> { this.commands.push(command); return this.result; }
  async readFile(_handle: WorkspaceHandle, path: string): Promise<Uint8Array> { this.readPaths.push(path); return this.bytes; }
  async terminate(_handle: WorkspaceHandle): Promise<void> {}
}

const handle = { providerId:"fake", providerWorkspaceId:"fake" };

describe("ScreenshotService", () => {
  it("returns PNG bytes for the desktop preset", async () => {
    const provider = new ScreenshotProvider({ exitCode:0, stdout:"", stderr:"" });
    const result = await new ScreenshotService(provider, { nowMs:()=>100 }).capture(handle, { url:"http://127.0.0.1:4173", viewport:"desktop" });
    assert.equal(result.status, "PASSED");
    if (result.status !== "PASSED") return;
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.width, 1440);
    assert.equal(result.height, 900);
    assert.deepEqual(result.bytes, PNG);
    assert.match(provider.commands[0]?.argv.join(" ") ?? "", /chromium\.launch/);
    assert.deepEqual(provider.readPaths, ["/tmp/agent-workspace-screenshot.png"]);
  });

  it("supports tablet, mobile and explicit viewports", () => {
    assert.deepEqual(resolveViewport("tablet"), VIEWPORT_PRESETS.tablet);
    assert.deepEqual(resolveViewport("mobile"), VIEWPORT_PRESETS.mobile);
    assert.deepEqual(resolveViewport({width:1280,height:720}), {width:1280,height:720});
  });

  it("rejects invalid explicit viewport dimensions", () => {
    assert.throws(() => resolveViewport({width:0,height:720}), /1 to 4096/);
    assert.throws(() => resolveViewport({width:5000,height:720}), /1 to 4096/);
  });

  it("returns structured browser failures without reading an artifact", async () => {
    const provider = new ScreenshotProvider({ exitCode:1, stdout:"", stderr:"browser failed" });
    const result = await new ScreenshotService(provider).capture(handle, { url:"http://127.0.0.1:4173", viewport:"mobile" });
    assert.equal(result.status, "FAILED");
    if (result.status === "FAILED") assert.match(result.failureSummary, /browser failed/);
    assert.equal(provider.readPaths.length, 0);
  });

  it("rejects non-PNG output", async () => {
    const provider = new ScreenshotProvider({ exitCode:0, stdout:"", stderr:"" }, new Uint8Array([1,2,3]));
    const result = await new ScreenshotService(provider).capture(handle, { url:"http://127.0.0.1:4173" });
    assert.equal(result.status, "FAILED");
    if (result.status === "FAILED") assert.match(result.failureSummary, /not a PNG/);
  });
});
