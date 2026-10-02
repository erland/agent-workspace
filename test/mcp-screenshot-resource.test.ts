import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentWorkspaceMcpServer } from "../src/mcp/server.js";
import type { AgentWorkspaceTools } from "../src/mcp/tool-service.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function tools(): AgentWorkspaceTools {
  return {
    async getCapabilities() { return { ok: true, result: {} }; },
    async getProfile() { return { ok: true, result: {} }; },
    async createWorkspace() { return { ok: true, result: {} }; },
    async uploadZip() { return { ok: true, result: {} }; },
    async uploadZipFromUrl() { return { ok: true, result: {} }; },
    async verifyProject() { return { ok: true, result: {} }; },
    async startPrototype() { return { ok: true, result: {} }; },
    async screenshotPrototype() {
      return {
        ok: true,
        result: {
          status: "PASSED",
          mimeType: "image/png",
          width: 1440,
          height: 900,
          bytes: PNG,
          artifactId: "shot_1",
          fileName: "prototype-desktop-shot_1.png",
          durationMs: 12
        }
      };
    },
    async readScreenshotArtifact({ workspaceId, artifactId }) {
      assert.equal(workspaceId, "ws_1");
      assert.equal(artifactId, "shot_1");
      return PNG;
    },
    async destroyWorkspace() { return { ok: true, result: {} }; }
  };
}

describe("prototype_screenshot MCP resource contract", () => {
  it("returns a resource_link and serves the PNG through resources/read", async () => {
    const server = createAgentWorkspaceMcpServer(tools());
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      const screenshotTool = listed.tools.find((tool) => tool.name === "prototype_screenshot") as any;
      assert.equal(
        screenshotTool?._meta?.ui?.resourceUri,
        "ui://agent-workspace/screenshot-viewer-v1.html"
      );
      assert.equal(
        screenshotTool?._meta?.["openai/outputTemplate"],
        "ui://agent-workspace/screenshot-viewer-v1.html"
      );

      const result = await client.callTool({
        name: "prototype_screenshot",
        arguments: { workspaceId: "ws_1", viewport: "desktop" }
      });

      const link = result.content.find((item) => item.type === "resource_link");
      assert.ok(link && link.type === "resource_link");
      assert.equal(link.mimeType, "image/png");
      assert.equal(link.name, "prototype-desktop-shot_1.png");
      assert.equal(link.uri, "agent-workspace://screenshots/ws_1/shot_1");
      assert.equal(link.size, PNG.byteLength);

      const image = result.content.find((item) => item.type === "image");
      assert.ok(image && image.type === "image");
      assert.equal(image.mimeType, "image/png");

      const structured = result.structuredContent as any;
      assert.equal(structured.result.resourceUri, link.uri);
      assert.equal(structured.result.byteSize, PNG.byteLength);

      const metadata = (result as any)._meta;
      assert.equal(metadata.screenshot.mimeType, "image/png");
      assert.equal(metadata.screenshot.fileName, "prototype-desktop-shot_1.png");
      assert.deepEqual(
        Buffer.from(metadata.screenshot.data, "base64"),
        Buffer.from(PNG)
      );

      const viewer = await client.readResource({
        uri: "ui://agent-workspace/screenshot-viewer-v1.html"
      });
      assert.equal(viewer.contents.length, 1);
      const viewerContent = viewer.contents[0] as any;
      assert.equal(viewerContent.mimeType, "text/html;profile=mcp-app");
      assert.match(viewerContent.text, /ui\/notifications\/tool-result/);
      assert.match(viewerContent.text, /data:.*;base64/);
      assert.equal(viewerContent._meta?.ui?.prefersBorder, true);

      const resource = await client.readResource({ uri: link.uri });
      assert.equal(resource.contents.length, 1);
      const content = resource.contents[0]!;
      assert.equal(content.mimeType, "image/png");
      assert.ok("blob" in content);
      if ("blob" in content) {
        assert.deepEqual(Buffer.from(content.blob, "base64"), Buffer.from(PNG));
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
