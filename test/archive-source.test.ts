import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RemoteArchiveDownloader, decodeBase64Archive } from "../src/mcp/archive-source.js";

function publicLookup() {
  return async () => [{ address: "203.0.113.10", family: 4 }] as any;
}

describe("remote archive downloader", () => {
  it("downloads a public HTTPS archive", async () => {
    const expected = new Uint8Array([1, 2, 3, 4]);
    const downloader = new RemoteArchiveDownloader({
      lookup: publicLookup() as any,
      fetchImpl: (async () => new Response(expected, {
        status: 200,
        headers: { "content-length": String(expected.byteLength) }
      })) as typeof fetch
    });

    const actual = await downloader.download("https://files.example.test/project.zip");
    assert.deepEqual(actual, expected);
  });

  it("follows a redirect only after validating the redirected host", async () => {
    const requested: string[] = [];
    const downloader = new RemoteArchiveDownloader({
      lookup: publicLookup() as any,
      fetchImpl: (async (input: any) => {
        const url = String(input);
        requested.push(url);
        if (requested.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.test/project.zip" }
          });
        }
        return new Response(new Uint8Array([9]), { status: 200 });
      }) as typeof fetch
    });

    const actual = await downloader.download("https://files.example.test/project.zip");
    assert.deepEqual([...actual], [9]);
    assert.deepEqual(requested, [
      "https://files.example.test/project.zip",
      "https://cdn.example.test/project.zip"
    ]);
  });

  it("rejects localhost and private IP destinations before fetch", async () => {
    let fetched = false;
    const downloader = new RemoteArchiveDownloader({
      lookup: (async () => [{ address: "127.0.0.1", family: 4 }]) as any,
      fetchImpl: (async () => {
        fetched = true;
        return new Response(new Uint8Array([1]));
      }) as typeof fetch
    });

    await assert.rejects(
      () => downloader.download("https://internal.example.test/project.zip"),
      /public addresses/
    );
    assert.equal(fetched, false);

    await assert.rejects(
      () => downloader.download("https://127.0.0.1/project.zip"),
      /private address/
    );
  });

  it("rejects oversized downloads from Content-Length and streamed bytes", async () => {
    const declared = new RemoteArchiveDownloader({
      maxBytes: 3,
      lookup: publicLookup() as any,
      fetchImpl: (async () => new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-length": "4" }
      })) as typeof fetch
    });
    await assert.rejects(
      () => declared.download("https://files.example.test/project.zip"),
      /exceeds limit/
    );

    const streamed = new RemoteArchiveDownloader({
      maxBytes: 3,
      lookup: publicLookup() as any,
      fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200
      })) as typeof fetch
    });
    await assert.rejects(
      () => streamed.download("https://files.example.test/project.zip"),
      /exceeds limit/
    );
  });

  it("keeps base64 as a portable fallback", () => {
    assert.deepEqual([...decodeBase64Archive("AQID")], [1, 2, 3]);
    assert.throws(() => decodeBase64Archive("***"), /valid base64/);
  });
});
