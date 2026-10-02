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
    async previewPrototype() { return { ok: true, result: { status: "AVAILABLE", url: "https://preview-example.modal.run", expiresAt: "2026-09-29T12:20:00.000Z", access: "temporary-public", port: 4173 } }; },
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
  it("returns the PNG inline without advertising a materializable resource link", async () => {
    const server = createAgentWorkspaceMcpServer(tools());
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      const screenshotTool = listed.tools.find((tool) => tool.name === "prototype_screenshot") as any;
      assert.equal(screenshotTool?._meta?.ui?.resourceUri, undefined);
      assert.equal(screenshotTool?._meta?.["openai/outputTemplate"], undefined);

      const result = await client.callTool({
        name: "prototype_screenshot",
        arguments: { workspaceId: "ws_1", viewport: "desktop" }
      });

      assert.equal(result.content.some((item) => item.type === "resource_link"), false);

      const image = result.content.find((item) => item.type === "image");
      assert.ok(image && image.type === "image");
      assert.equal(image.mimeType, "image/png");

      const structured = result.structuredContent as any;
      assert.equal(structured.result.resourceUri, "agent-workspace://screenshots/ws_1/shot_1");
      assert.equal(structured.result.byteSize, PNG.byteLength);
      assert.equal(structured.result.artifactId, "shot_1");

      assert.equal((result as any)._meta?.screenshot, undefined);

      const resource = await client.readResource({ uri: structured.result.resourceUri });
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

  it("renders multiple captured screenshots through the gallery widget", async () => {
    const server = createAgentWorkspaceMcpServer(tools());
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      const galleryTool = listed.tools.find((tool) => tool.name === "prototype_screenshot_gallery") as any;
      assert.equal(
        galleryTool?._meta?.ui?.resourceUri,
        "ui://agent-workspace/screenshot-gallery-v1.html"
      );

      const result = await client.callTool({
        name: "prototype_screenshot_gallery",
        arguments: {
          workspaceId: "ws_1",
          screenshots: [
            { artifactId: "shot_1", label: "Desktop", width: 1440, height: 900 },
            { artifactId: "shot_1", label: "Mobile", width: 390, height: 844 }
          ],
          selectedArtifactId: "shot_1"
        }
      });

      const structured = result.structuredContent as any;
      assert.equal(structured.result.status, "PASSED");
      assert.equal(structured.result.selectedArtifactId, "shot_1");
      assert.equal(structured.result.screenshots.length, 2);
      assert.equal(result.content.filter((item) => item.type === "resource_link").length, 0);

      const metadata = (result as any)._meta;
      assert.equal(metadata.gallery.screenshots.length, 2);
      assert.deepEqual(
        Buffer.from(metadata.gallery.screenshots[0].data, "base64"),
        Buffer.from(PNG)
      );

      const viewer = await client.readResource({
        uri: "ui://agent-workspace/screenshot-gallery-v1.html"
      });
      assert.equal(viewer.contents.length, 1);
      const viewerContent = viewer.contents[0] as any;
      assert.equal(viewerContent.mimeType, "text/html;profile=mcp-app");
      assert.match(viewerContent.text, /requestDisplayMode/);
      assert.match(viewerContent.text, /setWidgetState/);
      assert.match(viewerContent.text, /aria-pressed/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("renders a single captured screenshot through the gallery widget", async () => {
    const server = createAgentWorkspaceMcpServer(tools());
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "prototype_screenshot_gallery",
        arguments: {
          workspaceId: "ws_1",
          screenshots: [
            { artifactId: "shot_1", label: "Desktop", width: 1440, height: 900 }
          ]
        }
      });

      const structured = result.structuredContent as any;
      assert.equal(structured.result.status, "PASSED");
      assert.equal(structured.result.screenshots.length, 1);
      assert.equal(structured.result.selectedArtifactId, "shot_1");
      assert.equal(result.content.filter((item) => item.type === "resource_link").length, 0);
      assert.equal((result as any)._meta.gallery.screenshots.length, 1);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("returns a clickable interactive preview link without adding a widget", async () => {
    const server = createAgentWorkspaceMcpServer(tools());
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      const previewTool = listed.tools.find((tool) => tool.name === "prototype_preview_link") as any;
      assert.equal(previewTool?._meta?.ui?.resourceUri, undefined);

      const result = await client.callTool({
        name: "prototype_preview_link",
        arguments: { workspaceId: "ws_1" }
      });
      const structured = result.structuredContent as any;
      assert.equal(structured.result.url, "https://preview-example.modal.run");
      assert.equal(structured.result.expiresAt, "2026-09-29T12:20:00.000Z");
      assert.equal(structured.result.access, "temporary-public");
      const textContent = result.content.find((item) => item.type === "text");
      assert.ok(textContent && textContent.type === "text");
      assert.match(textContent.text, /https:\/\/preview-example\.modal\.run/);
    } finally {
      await client.close();
      await server.close();
    }
  });

});
