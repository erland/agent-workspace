import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ArchiveValidationError,
  validateZipArchive
} from "../src/archive/archive-validator.js";
import { makeStoredZip } from "./zip-fixture.js";

describe("validateZipArchive", () => {
  it("accepts a valid project archive and reports sizes", () => {
    const archive = makeStoredZip([
      { path: "package.json", content: '{"name":"demo"}' },
      { path: "src/index.js", content: "console.log('ok');" }
    ]);

    const result = validateZipArchive(archive);

    assert.equal(result.entryCount, 2);
    assert.equal(result.totalUncompressedBytes, 33);
    assert.deepEqual(result.entries.map((entry) => entry.path), [
      "package.json",
      "src/index.js"
    ]);
  });


  it("enforces compressed archive size limits", () => {
    const archive = makeStoredZip([{ path: "a.txt", content: "abc" }]);

    assert.throws(
      () => validateZipArchive(archive, { maxCompressedBytes: archive.byteLength - 1 }),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "ARCHIVE_TOO_LARGE"
    );
  });

  it("enforces entry count limits", () => {
    const archive = makeStoredZip([
      { path: "a.txt", content: "a" },
      { path: "b.txt", content: "b" }
    ]);

    assert.throws(
      () => validateZipArchive(archive, { maxEntries: 1 }),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "TOO_MANY_ENTRIES"
    );
  });

  it("enforces path length limits", () => {
    const archive = makeStoredZip([{ path: "123456.txt", content: "x" }]);

    assert.throws(
      () => validateZipArchive(archive, { maxPathLength: 5 }),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "PATH_TOO_LONG"
    );
  });

  it("blocks path traversal", () => {
    const archive = makeStoredZip([{ path: "../escape.txt", content: "bad" }]);

    assert.throws(
      () => validateZipArchive(archive),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "ILLEGAL_PATH"
    );
  });

  it("blocks zip-bomb-like declared uncompressed size above configured limit", () => {
    const archive = Buffer.from(makeStoredZip([{ path: "large.txt", content: "x" }]));
    // Central directory starts immediately after the local header + filename + one byte of data.
    const centralOffset = archive.readUInt32LE(archive.length - 6);
    archive.writeUInt32LE(10_000, centralOffset + 24);

    assert.throws(
      () => validateZipArchive(archive, { maxUncompressedBytes: 100 }),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "UNCOMPRESSED_TOO_LARGE"
    );
  });

  it("returns a structured error for malformed archives", () => {
    assert.throws(
      () => validateZipArchive(Buffer.from("not-a-zip")),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "MALFORMED_ARCHIVE"
    );
  });

  it("rejects symbolic links", () => {
    const symlinkMode = 0o120777 << 16;
    const archive = makeStoredZip([
      { path: "link", content: "target", externalAttributes: symlinkMode >>> 0 }
    ]);

    assert.throws(
      () => validateZipArchive(archive),
      (error: unknown) =>
        error instanceof ArchiveValidationError && error.code === "SYMLINK_ENTRY"
    );
  });
});
