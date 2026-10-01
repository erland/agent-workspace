import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AgentWorkspaceTools, ToolResult } from "./tool-service.js";
import {
  EmptyInputSchema,
  JsonObjectOutputSchema,
  PrototypeScreenshotInputSchema,
  ScreenshotOutputSchema,
  WorkspaceCreateInputSchema,
  WorkspaceIdInputSchema,
  WorkspaceUploadZipFromUrlInputSchema,
  WorkspaceUploadZipInputSchema
} from "./schemas.js";

export function createAgentWorkspaceMcpServer(tools: AgentWorkspaceTools): McpServer {
  const server = new McpServer({ name: "agent-workspace", version: "0.1.0" });

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

  registerJsonTool(server, "project_verify", "Build and test the uploaded npm or Maven project.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.verifyProject(input));
  registerJsonTool(server, "prototype_start", "Install dependencies and start an uploaded npm web prototype.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.startPrototype(input));

  server.registerTool(
    "prototype_screenshot",
    {
      description: "Capture a PNG screenshot of a running prototype.",
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
        const structured = { result: { status: result.status, mimeType: result.mimeType, width: result.width, height: result.height, durationMs: result.durationMs } };
        return {
          structuredContent: structured,
          content: [
            { type: "text" as const, text: JSON.stringify(structured) },
            { type: "image" as const, data: Buffer.from(result.bytes).toString("base64"), mimeType: result.mimeType }
          ]
        };
      }
      const structured = { result: { status: result.status, durationMs: result.durationMs, failureSummary: result.failureSummary, logExcerpt: result.logExcerpt } };
      return { structuredContent: structured, content: [{ type: "text" as const, text: JSON.stringify(structured) }] };
    }
  );

  registerJsonTool(server, "workspace_destroy", "Terminate a workspace and release its sandbox resources.", WorkspaceIdInputSchema, async (input: z.infer<typeof WorkspaceIdInputSchema>) => tools.destroyWorkspace(input));
  return server;
}

function registerJsonTool<TInput>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: any,
  handler: (input: TInput) => Promise<ToolResult<unknown>>
): void {
  server.registerTool(name, { description, inputSchema, outputSchema: JsonObjectOutputSchema }, async (input: TInput) => jsonToolResult(await handler(input)));
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
