import assert from "node:assert/strict";
import { it } from "node:test";
import { normalizeToolError } from "../src/mcp/errors.js";

it("uses actionable codes for file and artifact retrieval errors", () => {
  const cases = [
    ["Invalid archive path", "INVALID_PATH"],
    ["Invalid captureFiles path: ../secret", "INVALID_PATH"],
    ["File not found in ZIP", "FILE_NOT_FOUND"],
    ["Artifact not found: art_unknown", "ARTIFACT_NOT_FOUND"],
    ["Access denied", "ACCESS_DENIED"],
    ["unexpected provider failure", "INTERNAL_ERROR"]
  ] as const;
  for (const [message, code] of cases) {
    assert.equal(normalizeToolError(new Error(message)).error.code, code);
  }
});
