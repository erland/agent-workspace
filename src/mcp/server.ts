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
  registerJsonTool(server, "workspace_upload_zip", "Upload a base64 encoded ZIP project into a workspace.", WorkspaceUploadZipInputSchema, async (input: z.infer<typeof WorkspaceUploadZipInputSchema>) => tools.uploadZip(input));
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
  server.registerTool(name, { description, inputSchema, outputSchema: JsonObjectOutputSchema }, async (input: TInput) => {
    const response = await handler(input);
    if (!response.ok) return errorResult(response);
    const structured = { result: response.result };
    return { structuredContent: structured, content: [{ type: "text" as const, text: JSON.stringify(structured) }] };
  });
}

function errorResult(response: { ok: false; error: unknown }) {
  const body = { error: response.error };
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
