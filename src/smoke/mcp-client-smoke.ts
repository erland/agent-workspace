import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const expectedTools = [
  "get_capabilities",
  "get_profile",
  "workspace_create",
  "workspace_upload_zip",
  "workspace_upload_zip_from_url",
  "project_verify",
  "project_build",
  "artifact_get",
  "artifact_download_link",
  "workspace_destroy"
].sort();

const client = new Client({ name: "agent-workspace-dev010-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp/stdio.ts"],
  env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const actual = listed.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected MCP tools: ${actual.join(", ")}`);
  }

  const capabilities = await client.callTool({ name: "get_capabilities", arguments: {} });
  if (capabilities.isError) throw new Error("get_capabilities returned an MCP error");

  const created = await client.callTool({
    name: "workspace_create",
    arguments: { java: "21", node: "22", lifetimeMinutes: 5 }
  });
  if (created.isError) throw new Error(firstText(created) ?? "workspace_create failed");
  const createdBody = JSON.parse(firstText(created) ?? "{}") as { result?: { id?: string } };
  const workspaceId = createdBody.result?.id;
  if (!workspaceId) throw new Error("workspace_create did not return workspace id");

  const destroyed = await client.callTool({
    name: "workspace_destroy",
    arguments: { workspaceId }
  });
  if (destroyed.isError) throw new Error(firstText(destroyed) ?? "workspace_destroy failed");

  console.log(`MCP tools: ${actual.join(", ")}`);
  console.log(`workspace_create => ${workspaceId}`);
  console.log("workspace_destroy => OK");
} finally {
  await client.close();
}

function firstText(result: { content?: unknown[] }): string | undefined {
  for (const block of result.content ?? []) {
    if (typeof block === "object" && block !== null && (block as any).type === "text") {
      return String((block as any).text);
    }
  }
  return undefined;
}
