import assert from "node:assert/strict";
import { it } from "node:test";
import { gzipSync } from "node:zlib";
import { readTextFile } from "../src/artifact/file-reader.js";
import { makeStoredZip } from "./zip-fixture.js";
import { WorkspaceService } from "../src/workspace/workspace-service.js";
import { InMemoryArtifactRepository } from "../src/persistence/in-memory.js";
import { InMemoryObjectStore } from "../src/storage/in-memory-object-store.js";
import type { SandboxProvider, WorkspaceHandle, CreateWorkspaceOptions, Command, ExecutionResult } from "../src/core/sandbox-provider.js";

it("reads selected UTF-8 ZIP source without starting Modal and supports pagination", async () => {
  let creates = 0;
  const provider: SandboxProvider = {
    async createWorkspace(_o: CreateWorkspaceOptions): Promise<WorkspaceHandle> { creates++; throw new Error("must not run"); },
    async uploadArchive() {},
    async exec(_h: WorkspaceHandle, _c: Command): Promise<ExecutionResult> { throw new Error("must not run"); },
    async readFile() { throw new Error("must not run"); },
    async terminate() {}
  };
  const service = new WorkspaceService(provider, {
    idFactory: () => "ws_read",
    schedule: () => ({}),
    objectStore: new InMemoryObjectStore(),
    artifactRepository: new InMemoryArtifactRepository()
  });
  await service.create();
  await service.uploadZip("ws_read", makeStoredZip([
    { path: "package.json", content: '{"name":"example","scripts":{"build":"echo hi"}}' },
    { path: "src/main.ts", content: "console.log('ok')" }
  ]));
  const first = await service.fileRead({ workspaceId: "ws_read", path: "src/main.ts", limit: 8 });
  assert.equal(first.text, "console.");
  assert.equal(first.nextOffset, 8);
  const second = await service.fileRead({ workspaceId: "ws_read", path: "src/main.ts", offset: first.nextOffset!, limit: 200 });
  assert.equal(first.text + second.text, "console.log('ok')");
  await assert.rejects(() => service.fileRead({ workspaceId: "ws_read", path: "../secret" }), /Invalid archive path/);
  assert.equal(creates, 0);
});

it("reads files inside gzip TAR archives and rejects missing names", () => {
  const body = Buffer.from("<html>ok</html>");
  const tar = Buffer.alloc(1024);
  tar.write("./index.html", 0, "utf8");
  tar.write("0000644\0", 100, "ascii");
  tar.write(body.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  tar[156] = 48;
  const blob = gzipSync(Buffer.concat([tar.subarray(0, 512), Buffer.concat([body, Buffer.alloc(512 - body.length)]), Buffer.alloc(1024)]));
  assert.equal(readTextFile(blob, "dist.tar.gz", "index.html").text, "<html>ok</html>");
  assert.throws(() => readTextFile(blob, "dist.tar.gz", "bad.txt"), /File not found/);
});

it("reads direct text artifacts and refuses invalid pagination", () => {
  assert.equal(readTextFile(Buffer.from("hello"), "build.log").text, "hello");
  assert.throws(() => readTextFile(Buffer.from("hello"), "build.log", undefined, -1), /Invalid text read/);
});
