import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AgentWorkspaceTools, ToolResult } from "./tool-service.js";
import {
  ArtifactDownloadLinkOutputSchema,
  ArtifactIdInputSchema,
  ArtifactOutputSchema,
  EmptyInputSchema,
  JsonObjectOutputSchema,
  ProjectBuildInputSchema,
  WorkspaceCreateInputSchema,
  WorkspaceIdInputSchema,
  WorkspaceUploadZipFromUrlInputSchema,
  WorkspaceUploadZipInputSchema
} from "./schemas.js";
import { ARTIFACT_RESOURCE_TEMPLATE, artifactResourceUri, singleArtifactTemplateValue } from "./artifact-resource.js";

const AGENT_WORKSPACE_DESCRIPTION =
  "Creates temporary sandbox workspaces for verifying and building uploaded npm and Maven projects and publishing temporary build artifacts.";
const AGENT_WORKSPACE_WEBSITE = "https://agent-workspace.apphome.one/about";
const AGENT_WORKSPACE_ICON_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAB7UlEQVR4nO2aMU7DUAyGHQQTjCywwsrA0IWBhQmBxAHYkFiBAzBygLYrUjcOgITExMLA0oELwDGYGMKUKI1Iajv2+wPxJ1VK1Dz39//8/JK22dbeSU4DZgUtAE0YgBaAJgxAC0ATBqAFoAkD0ALQrGoGvT4/WOsw4/D4XHS9uAL6nDyRXJ/IgL4nXyDRmXEfhqpBs6uL8jifzmj97bQ8v1zbKY/HowlbiAec5SBeAtXkiagxeSKim/m1NHxyBr8LhAHSAfl0tnD+dfBUHt9/fy68h+4BHFT3AW0mjDvJSU8sAbQANOwlsL254akDxuArIAxAC0ATBqAFoAkD0ALQuBqwOzpjXXd0+16+tDG0uBlQCO+SgEWMZbgYUBfclkB11l/u9lUxupCkB3zMH5OM0WBuQH2muiRSH+tRBaYGSJNvKv+2GNYmmBng3a29PsvMgPpMWa5hz9huFbBsljjlr40twa0CPOllBRD5NCzLXeU3zLdBjgnc8vdOnijRjZCmElLtKi4GWHRtz85fxa0CCsF14ZLu3xTDEtclYCHce3dR/TTWhWWznpr4RggtAE0YgBaAJgzgXpjyed8Crl5RBfwVEyQ6xUug7yZI9al6QF9N0Ohi/1P0vxK7AFoAmjAALQBNGIAWgCYMQAtA8wO6c5LmRtskgAAAAABJRU5ErkJggg==";

export function createAgentWorkspaceMcpServer(tools: AgentWorkspaceTools): McpServer {
  const server = new McpServer({
    name: "agent-workspace",
    title: "Agent Workspace",
    version: process.env.AGENT_WORKSPACE_VERSION ?? process.env.npm_package_version ?? "0.1.0-dev.16.6",
    description: AGENT_WORKSPACE_DESCRIPTION,
    websiteUrl: AGENT_WORKSPACE_WEBSITE,
    icons: [{
      src: AGENT_WORKSPACE_ICON_DATA_URI,
      mimeType: "image/png",
      sizes: ["64x64"]
    }]
  });

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

  registerJsonTool(server, "get_capabilities", "List supported runtimes, build systems and artifact capabilities.", EmptyInputSchema, async () => tools.getCapabilities());
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
      description: "Build the uploaded project in a short-lived execution sandbox and publish one or more temporary build artifacts. outputs may select project-relative files or directories; files are published unchanged and directories are packaged as .tar.gz. If outputs are omitted, Agent Workspace detects conventional npm or Maven outputs.",
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
  server.registerTool(
    "artifact_download_link",
    {
      annotations: toolAnnotations("artifact_download_link"),
      description: "Create a short-lived signed HTTPS URL for a published artifact. The URL is intended for immediate handoff to external consumers such as PWA Preview preview_create(sourceUrl).",
      inputSchema: ArtifactIdInputSchema,
      outputSchema: ArtifactDownloadLinkOutputSchema
    },
    async (input: z.infer<typeof ArtifactIdInputSchema>) => jsonToolResult(await tools.artifactDownloadLink(input))
  );

  registerJsonTool(server, "workspace_destroy", "Terminate a workspace and release its sandbox resources.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.destroyWorkspace(input));
  return server;
}


function toolAnnotations(name: string) {
  const readOnly = new Set(["get_capabilities", "get_profile", "artifact_get"]);
  const destructive = new Set(["workspace_destroy"]);
  const openWorld = new Set(["workspace_create", "workspace_upload_zip_from_url", "project_verify", "project_build", "workspace_destroy"]);
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

