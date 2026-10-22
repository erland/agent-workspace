import assert from "node:assert/strict";
import { it } from "node:test";
import { gzipSync } from "node:zlib";
import { readBinaryFile, readTextFile } from "../src/artifact/file-reader.js";
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

it("reads arbitrary binary bytes with byte-based pagination and exact Base64 roundtrip", () => {
  const bytes = Buffer.from([0, 255, 128, 1, 2, 3, 254, 0]);
  const first = readBinaryFile(bytes, "image.png", undefined, 0, 3);
  assert.equal(first.encoding, "base64");
  assert.equal(first.sizeBytes, 8);
  assert.equal(first.nextOffset, 3);
  assert.deepEqual(Buffer.from(first.content, "base64"), bytes.subarray(0, 3));
  const second = readBinaryFile(bytes, "image.png", undefined, first.nextOffset!, 5);
  assert.deepEqual(Buffer.concat([Buffer.from(first.content, "base64"), Buffer.from(second.content, "base64")]), bytes);
  assert.equal(second.nextOffset, null);
  assert.equal(second.truncated, false);
  assert.equal(readBinaryFile(bytes, "image.png", undefined, 100, 10).content, "");
  assert.throws(() => readTextFile(bytes, "image.png"), /utf-8|encoded data/i);
  assert.throws(() => readBinaryFile(bytes, "image.png", undefined, 0, 65537), /Invalid binary read/);
});

it("reads a binary ZIP entry in Base64 without UTF-8 decoding", () => {
  const data = makeStoredZip([{ path: "image.png", content: "PNG!" }]);
  const result = readBinaryFile(data, "source.zip", "image.png", 0, 2);
  assert.equal(Buffer.from(result.content, "base64").toString("utf8"), "PN");
  assert.equal(result.nextOffset, 2);
});
