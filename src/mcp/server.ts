import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AgentWorkspaceTools, ToolResult } from "./tool-service.js";
import {
  ArtifactIdInputSchema,
  ArtifactOutputSchema,
  EmptyInputSchema,
  JsonObjectOutputSchema,
  ProjectBuildInputSchema,
  PrototypePreviewOutputSchema,
  PrototypeScreenshotGalleryInputSchema,
  PrototypeScreenshotInputSchema,
  ScreenshotGalleryOutputSchema,
  ScreenshotOutputSchema,
  WorkspaceCreateInputSchema,
  WorkspaceIdInputSchema,
  WorkspaceUploadZipFromUrlInputSchema,
  WorkspaceUploadZipInputSchema
} from "./schemas.js";
import { SCREENSHOT_RESOURCE_TEMPLATE, screenshotResourceUri, singleTemplateValue } from "./screenshot-resource.js";
import { ARTIFACT_RESOURCE_TEMPLATE, artifactResourceUri, singleArtifactTemplateValue } from "./artifact-resource.js";
import { SCREENSHOT_GALLERY_HTML, SCREENSHOT_GALLERY_MIME_TYPE, SCREENSHOT_GALLERY_URI } from "./screenshot-gallery.js";

export function createAgentWorkspaceMcpServer(tools: AgentWorkspaceTools): McpServer {
  const server = new McpServer({ name: "agent-workspace", version: "0.1.0" });

  server.registerResource(
    "prototype-screenshot-gallery",
    SCREENSHOT_GALLERY_URI,
    {
      title: "Prototype screenshot gallery",
      description: "Selectable gallery for comparing prototype screenshots.",
      mimeType: SCREENSHOT_GALLERY_MIME_TYPE
    },
    async () => ({
      contents: [{
        uri: SCREENSHOT_GALLERY_URI,
        mimeType: SCREENSHOT_GALLERY_MIME_TYPE,
        text: SCREENSHOT_GALLERY_HTML,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] }
          },
          "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] }
        }
      }]
    })
  );

  server.registerResource(
    "build-artifact",
    new ResourceTemplate(ARTIFACT_RESOURCE_TEMPLATE, { list: undefined }),
    {
      title: "Build artifact",
      description: "Build artifact published by Agent Workspace.",
      mimeType: "application/octet-stream"
    },
    async (uri, variables) => {
      const artifactId = singleArtifactTemplateValue(variables.artifactId);
      if (!artifactId) throw new Error("Invalid artifact resource URI");
      const { artifact, bytes } = await tools.readArtifact({ artifactId });
      return {
        contents: [{
          uri: uri.href,
          mimeType: artifact.mediaType,
          blob: Buffer.from(bytes).toString("base64")
        }]
      };
    }
  );

  server.registerResource(
    "prototype-screenshot",
    new ResourceTemplate(SCREENSHOT_RESOURCE_TEMPLATE, { list: undefined }),
    {
      title: "Prototype screenshot",
      description: "PNG screenshot captured from a running prototype.",
      mimeType: "image/png"
    },
    async (uri, variables) => {
      const workspaceId = singleTemplateValue(variables.workspaceId);
      const artifactId = singleTemplateValue(variables.artifactId);
      if (!workspaceId || !artifactId) throw new Error("Invalid screenshot resource URI");
      const bytes = await tools.readScreenshotArtifact({ workspaceId, artifactId });
      return {
        contents: [{
          uri: uri.href,
          mimeType: "image/png",
          blob: Buffer.from(bytes).toString("base64")
        }]
      };
    }
  );

  registerJsonTool(server, "get_capabilities", "List supported runtimes, build systems and browser capabilities.", EmptyInputSchema, async () => tools.getCapabilities());
  registerJsonTool(server, "get_profile", "Show the current Agent Workspace identity and execution-provider connection.", EmptyInputSchema, async () => tools.getProfile());
  registerJsonTool(server, "workspace_create", "Create a temporary sandbox workspace.", WorkspaceCreateInputSchema, async (input: z.infer<typeof WorkspaceCreateInputSchema>) => {
    const normalizedInput: { java?: "17" | "21" | "25"; node?: "20" | "22"; lifetimeMinutes?: number } = {};
    if (input.java !== undefined) normalizedInput.java = input.java;
    if (input.node !== undefined) normalizedInput.node = input.node;
    if (input.lifetimeMinutes !== undefined) normalizedInput.lifetimeMinutes = input.lifetimeMinutes;
    return tools.createWorkspace(normalizedInput);
  });

  server.registerTool(
    "workspace_upload_zip",
    {
      annotations: toolAnnotations("workspace_upload_zip"),
      description: "Upload a ZIP project into a workspace. ChatGPT may provide archive as a native file parameter; archiveBase64 remains available as a portable fallback.",
      inputSchema: WorkspaceUploadZipInputSchema,
      outputSchema: JsonObjectOutputSchema,
      _meta: { "openai/fileParams": ["archive"] }
    },
    async (input: z.infer<typeof WorkspaceUploadZipInputSchema>) => jsonToolResult(await tools.uploadZip(input))
  );

  registerJsonTool(
    server,
    "workspace_upload_zip_from_url",
    "Download a ZIP project from a public HTTPS URL and upload it into a workspace. Intended for MCP hosts that do not support native file parameters.",
    WorkspaceUploadZipFromUrlInputSchema,
    async (input: z.infer<typeof WorkspaceUploadZipFromUrlInputSchema>) => tools.uploadZipFromUrl(input)
  );

  registerJsonTool(server, "project_verify", "Compile/test the uploaded npm or Maven project in a short-lived execution sandbox. No build artifact is retained.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.verifyProject(input));

  server.registerTool(
    "project_build",
    {
      annotations: toolAnnotations("project_build"),
      description: "Build the uploaded project in a short-lived execution sandbox and publish one or more temporary build artifacts. If outputs are omitted, Agent Workspace detects conventional npm or Maven outputs.",
      inputSchema: ProjectBuildInputSchema,
      outputSchema: JsonObjectOutputSchema
    },
    async (input: z.infer<typeof ProjectBuildInputSchema>) => {
      const response = await tools.buildProject(input);
      if (!response.ok) return errorResult(response);
      const result = response.result as any;
      const structured = {
        result: {
          ...result,
          artifacts: (result.artifacts ?? []).map((artifact: any) => ({
            ...artifact,
            resourceUri: artifactResourceUri(artifact.id)
          }))
        }
      };
      return {
        structuredContent: structured,
        content: [
          { type: "text" as const, text: JSON.stringify(structured) },
          ...(structured.result.artifacts ?? []).map((artifact: any) => ({
            type: "resource_link" as const,
            uri: artifact.resourceUri,
            name: artifact.filename,
            title: artifact.name,
            mimeType: artifact.mediaType,
            size: artifact.sizeBytes
          }))
        ]
      };
    }
  );

  server.registerTool(
    "artifact_get",
    {
      annotations: toolAnnotations("artifact_get"),
      description: "Return metadata and an MCP resource link for a previously published temporary build artifact.",
      inputSchema: ArtifactIdInputSchema,
      outputSchema: ArtifactOutputSchema
    },
    async (input: z.infer<typeof ArtifactIdInputSchema>) => {
      const response = await tools.getArtifact(input);
      if (!response.ok) return errorResult(response);
      const artifact = response.result as any;
      const structured = { result: { ...artifact, resourceUri: artifactResourceUri(artifact.id) } };
      return {
        structuredContent: structured,
        content: [
          { type: "text" as const, text: JSON.stringify(structured) },
          {
            type: "resource_link" as const,
            uri: structured.result.resourceUri,
            name: artifact.filename,
            title: artifact.name,
            mimeType: artifact.mediaType,
            size: artifact.sizeBytes
          }
        ]
      };
    }
  );
  registerJsonTool(
    server,
    "artifact_download_link",
    "Create a short-lived signed HTTPS download link for a published artifact. Use this when an external deployment service or user needs to fetch the artifact without MCP resource access.",
    ArtifactIdInputSchema,
    async (input: z.infer<typeof ArtifactIdInputSchema>) => tools.artifactDownloadLink(input)
  );

  registerJsonTool(server, "prototype_start", "Install dependencies and start an uploaded npm web prototype.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.startPrototype(input));

  server.registerTool(
    "prototype_preview_link",
    {
      annotations: toolAnnotations("prototype_preview_link"),
      description: "Return the temporary public HTTPS link for a running prototype. Use only when the user asks to open, try, click through, or interact with the prototype themselves. The link expires when the 20-minute workspace sandbox expires.",
      inputSchema: WorkspaceIdInputSchema,
      outputSchema: PrototypePreviewOutputSchema
    },
    async (input: z.infer<typeof WorkspaceIdInputSchema>) => {
      const response = await tools.previewPrototype(input);
      if (!response.ok) return errorResult(response);
      const structured = { result: response.result };
      const result = response.result as any;
      return {
        structuredContent: structured,
        content: [{
          type: "text" as const,
          text: `Interactive prototype: ${result.url}\nExpires: ${result.expiresAt}\nAccess: anyone with this temporary link can open it until the sandbox expires.`
        }]
      };
    }
  );

  server.registerTool(
    "prototype_screenshot",
    {
      annotations: toolAnnotations("prototype_screenshot"),
      description: "Capture exactly one PNG screenshot of a running prototype. Use desktop/tablet/mobile for generic views, device + orientation for named mobile/tablet profiles, or explicit width/height. Do not create additional orientations or device variants unless the user explicitly requested them.",
      inputSchema: PrototypeScreenshotInputSchema,
      outputSchema: ScreenshotOutputSchema
    },
    async (input) => {
      const normalizedInput = input.viewport === undefined
        ? { workspaceId: input.workspaceId }
        : { workspaceId: input.workspaceId, viewport: input.viewport };
      const response = await tools.screenshotPrototype(normalizedInput);
      if (!response.ok) return errorResult(response);
      const result = response.result as any;
      if (result.status === "PASSED") {
        const resourceUri = screenshotResourceUri(input.workspaceId, result.artifactId);
        const structured = {
          result: {
            status: result.status,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            resourceUri,
            fileName: result.fileName,
            byteSize: result.bytes.byteLength,
            artifactId: result.artifactId
          }
        };
        const screenshotData = Buffer.from(result.bytes).toString("base64");
        return {
          structuredContent: structured,
          content: [
            { type: "text" as const, text: JSON.stringify(structured) },
            { type: "image" as const, data: screenshotData, mimeType: result.mimeType }
          ]
        };
      }
      const structured = { result: { status: result.status, durationMs: result.durationMs, failureSummary: result.failureSummary, logExcerpt: result.logExcerpt } };
      return { structuredContent: structured, content: [{ type: "text" as const, text: JSON.stringify(structured) }] };
    }
  );

  server.registerTool(
    "prototype_screenshot_gallery",
    {
      annotations: toolAnnotations("prototype_screenshot_gallery"),
      description: "Render one or more already captured prototype screenshots in the single visible screenshot UI. Always use this after prototype_screenshot when the user wants to see captured screenshots; use labels to distinguish desktop, tablet, mobile, or iterations.",
      inputSchema: PrototypeScreenshotGalleryInputSchema,
      outputSchema: ScreenshotGalleryOutputSchema,
      _meta: {
        ui: { resourceUri: SCREENSHOT_GALLERY_URI },
        "openai/outputTemplate": SCREENSHOT_GALLERY_URI
      }
    },
    async (input: z.infer<typeof PrototypeScreenshotGalleryInputSchema>) => {
      const screenshots = await Promise.all(input.screenshots.map(async (item) => {
        const bytes = await tools.readScreenshotArtifact({
          workspaceId: input.workspaceId,
          artifactId: item.artifactId
        });
        return {
          artifactId: item.artifactId,
          label: item.label,
          mimeType: "image/png" as const,
          ...(item.width !== undefined ? { width: item.width } : {}),
          ...(item.height !== undefined ? { height: item.height } : {}),
          resourceUri: screenshotResourceUri(input.workspaceId, item.artifactId),
          fileName: `prototype-${slugLabel(item.label)}-${item.artifactId}.png`,
          byteSize: bytes.byteLength,
          data: Buffer.from(bytes).toString("base64")
        };
      }));

      const requested = input.selectedArtifactId;
      const selectedArtifactId =
        requested !== undefined && screenshots.some((item) => item.artifactId === requested)
          ? requested
          : screenshots[0]!.artifactId;

      const structured = {
        result: {
          status: "PASSED" as const,
          selectedArtifactId,
          screenshots: screenshots.map(({ data: _data, ...item }) => item)
        }
      };

      return {
        structuredContent: structured,
        content: [
          { type: "text" as const, text: JSON.stringify(structured) }
        ],
        _meta: { gallery: { screenshots } }
      };
    }
  );

  registerJsonTool(server, "prototype_stop", "Stop the interactive prototype sandbox immediately while keeping the logical workspace and stored source/artifacts.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.stopPrototype(input));

  registerJsonTool(server, "workspace_destroy", "Terminate a workspace and release its sandbox resources.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.destroyWorkspace(input));
  return server;
}


function toolAnnotations(name: string) {
  const readOnly = new Set([
    "get_capabilities",
    "get_profile",
    "artifact_get",
    "prototype_preview_link",
    "prototype_screenshot_gallery"
  ]);
  const destructive = new Set(["prototype_stop", "workspace_destroy"]);
  const openWorld = new Set([
    "workspace_create",
    "workspace_upload_zip_from_url",
    "project_verify",
    "project_build",
    "prototype_start",
    "prototype_screenshot",
    "prototype_stop",
    "workspace_destroy"
  ]);
  return {
    readOnlyHint: readOnly.has(name),
    openWorldHint: openWorld.has(name),
    destructiveHint: destructive.has(name)
  };
}

function registerJsonTool<TInput>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: any,
  handler: (input: TInput) => Promise<ToolResult<unknown>>
): void {
  server.registerTool(name, { annotations: toolAnnotations(name), description, inputSchema, outputSchema: JsonObjectOutputSchema }, async (input: TInput) => jsonToolResult(await handler(input)));
}

function jsonToolResult(response: ToolResult<unknown>) {
  if (!response.ok) return errorResult(response);
  const structured = { result: response.result };
  return { structuredContent: structured, content: [{ type: "text" as const, text: JSON.stringify(structured) }] };
}

function errorResult(response: { ok: false; error: unknown }) {
  const body = { error: response.error };
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}


function slugLabel(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "screenshot";
}
