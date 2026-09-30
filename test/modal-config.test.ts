import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadModalConfig } from "../src/config/modal-config.js";

describe("loadModalConfig", () => {
  it("maps explicit Modal token credentials", () => {
    assert.deepEqual(
      loadModalConfig({
        MODAL_TOKEN_ID: "id",
        MODAL_TOKEN_SECRET: "secret",
        MODAL_APP_NAME: "agent-workspace-test"
      }),
      {
        tokenId: "id",
        tokenSecret: "secret",
        appName: "agent-workspace-test"
      }
    );
  });

  it("allows the Modal SDK to use the active local profile", () => {
    assert.deepEqual(loadModalConfig({}), {
      appName: "agent-workspace-dev"
    });
  });

  it("rejects half-configured token credentials", () => {
    assert.throws(
      () => loadModalConfig({ MODAL_TOKEN_ID: "id" }),
      /must either both be set or both be omitted/
    );
  });
});
