import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentWorkspaceMcpServer } from "../src/mcp/server.js";
import type { AgentWorkspaceTools } from "../src/mcp/tool-service.js";

describe("Agent Workspace MCP server metadata", () => {
  it("advertises title, description, website and icon during initialize", async () => {
    const server = createAgentWorkspaceMcpServer({} as AgentWorkspaceTools);
    const client = new Client({ name: "metadata-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const info = client.getServerVersion();
      assert.ok(info);
      assert.equal(info.name, "agent-workspace");
      assert.equal(info.title, "Agent Workspace");
      assert.match(info.version, /\S+/);
      assert.match(info.description ?? "", /temporary logical workspaces/i);
      assert.equal(info.websiteUrl, "https://agent-workspace.apphome.one/about");
      assert.equal(info.icons?.length, 1);
      assert.equal(info.icons?.[0]?.mimeType, "image/png");
      assert.deepEqual(info.icons?.[0]?.sizes, ["64x64"]);
      assert.match(info.icons?.[0]?.src ?? "", /^data:image\/png;base64,/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
