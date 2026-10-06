import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handlePublicInfoRequest } from "../src/http/public-info.js";

describe("public Marketplace information pages", () => {
  for (const [path, heading] of [
    ["/about", "Agent Workspace"],
    ["/support", "Support för Agent Workspace"],
    ["/privacy", "Integritetspolicy för Agent Workspace"],
    ["/terms", "Användarvillkor för Agent Workspace"]
  ] as const) {
    it(`serves ${path} without authentication`, async () => {
      const response = handlePublicInfoRequest(new Request(`https://workspace.example${path}`));
      assert.ok(response);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await response.text(), new RegExp(`<h1>${heading}<\\/h1>`));
    });
  }

  it("does not intercept unrelated routes", () => {
    assert.equal(handlePublicInfoRequest(new Request("https://workspace.example/mcp")), undefined);
  });
});
