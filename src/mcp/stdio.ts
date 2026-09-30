import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { developmentProfileFromEnv, StaticProfileProvider } from "./profile.js";
import { createAgentWorkspaceMcpServer } from "./server.js";
import { AgentWorkspaceToolService } from "./tool-service.js";

function createServer() {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const workspaces = new WorkspaceService(provider);
  const profiles = new StaticProfileProvider(developmentProfileFromEnv());
  return createAgentWorkspaceMcpServer(new AgentWorkspaceToolService(workspaces, profiles));
}

void serveStdio(createServer);
console.error("agent-workspace MCP server running on stdio");
