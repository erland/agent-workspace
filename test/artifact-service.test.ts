import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArtifactService } from "../src/artifact/artifact-service.js";
import { ArtifactDownloadSigner } from "../src/artifact/artifact-download.js";
import { InMemoryArtifactRepository } from "../src/persistence/in-memory.js";
import { InMemoryObjectStore } from "../src/storage/in-memory-object-store.js";

describe("ArtifactService", () => {
  it("publishes immutable metadata and bytes independently from a sandbox", async () => {
    const repo = new InMemoryArtifactRepository();
    const store = new InMemoryObjectStore();
    const now = new Date("2026-10-03T04:00:00.000Z");
    const service = new ArtifactService("u1", repo, store, {
      now: () => now,
      idFactory: () => "art_1",
      ttlMinutes: 60
    });

    const artifact = await service.publish({
      workspaceId: "ws_1",
      name: "frontend",
      kind: "static-web",
      filename: "frontend.tar.gz",
      mediaType: "application/gzip",
      bytes: new Uint8Array([1,2,3,4])
    });

    assert.equal(artifact.id, "art_1");
    assert.equal(artifact.expiresAt, "2026-10-03T05:00:00.000Z");
    assert.equal(artifact.sizeBytes, 4);
    assert.equal(artifact.sha256.length, 64);

    const read = await service.read("art_1");
    assert.deepEqual([...read.bytes], [1,2,3,4]);
  });

  it("rejects artifacts above the configured byte limit before storage", async () => {
    const repo = new InMemoryArtifactRepository();
    const store = new InMemoryObjectStore();
    const service = new ArtifactService("u1", repo, store, {
      idFactory: () => "art_large",
      maxArtifactBytes: 3
    });

    await assert.rejects(
      () => service.publish({
        workspaceId: "ws_1",
        name: "large",
        kind: "generic",
        filename: "large.bin",
        mediaType: "application/octet-stream",
        bytes: new Uint8Array([1,2,3,4])
      }),
      /exceeds maximum size/
    );
    assert.equal(await store.exists("artifacts/u1/art_large/large.bin"), false);
  });

  it("removes expired artifact bytes and metadata", async () => {
    const repo = new InMemoryArtifactRepository();
    const store = new InMemoryObjectStore();
    let now = new Date("2026-10-03T04:00:00.000Z");
    const service = new ArtifactService("u1", repo, store, {
      now: () => now,
      idFactory: () => "art_exp",
      ttlMinutes: 1
    });
    const artifact = await service.publish({
      workspaceId: "ws_1",
      name: "x",
      kind: "generic",
      filename: "x.bin",
      mediaType: "application/octet-stream",
      bytes: new Uint8Array([9])
    });
    now = new Date("2026-10-03T04:02:00.000Z");
    await assert.rejects(() => service.get(artifact.id), /expired/);
    assert.equal(await store.exists(artifact.storageKey), false);
  });
});

describe("ArtifactDownloadSigner", () => {
  it("creates and verifies short-lived artifact handoff URLs", () => {
    const now = Date.parse("2026-10-03T04:00:00.000Z");
    const signer = new ArtifactDownloadSigner(
      "0123456789abcdef0123456789abcdef0123456789abcdef",
      "https://workspace.example/",
      () => now
    );
    const artifact = {
      id: "art_1", userId: "u1", workspaceId: "ws_1", name: "app", kind: "jar",
      filename: "app.jar", mediaType: "application/java-archive", sizeBytes: 1,
      sha256: "x", storageKey: "artifacts/u1/art_1/app.jar",
      createdAt: "2026-10-03T04:00:00.000Z", expiresAt: "2026-10-03T05:00:00.000Z"
    };
    const link = signer.create(artifact, 600);
    const token = new URL(link.url).pathname.split("/").at(-1)!;
    assert.deepEqual(signer.verify(token), {
      artifactId: "art_1",
      userId: "u1",
      expiresAtEpochSeconds: Math.floor(now / 1000) + 600
    });
  });
});
