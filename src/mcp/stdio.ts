import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadModalConfig } from "../config/modal-config.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { developmentProfileFromEnv, StaticProfileProvider } from "./profile.js";
import { createAgentWorkspaceMcpServer } from "./server.js";
import { AgentWorkspaceToolService } from "./tool-service.js";
import { InMemoryArtifactRepository } from "../persistence/in-memory.js";
import { LocalVolumeObjectStore } from "../storage/local-volume-object-store.js";

function createServer() {
  const provider = new ModalSandboxProvider(loadModalConfig());
  const objectStore = new LocalVolumeObjectStore(process.env.AGENT_WORKSPACE_STORAGE_DIR ?? "/tmp/agent-workspace-data");
  const workspaces = new WorkspaceService(provider, {
    objectStore,
    artifactRepository: new InMemoryArtifactRepository()
  });
  const profiles = new StaticProfileProvider(developmentProfileFromEnv());
  return createAgentWorkspaceMcpServer(new AgentWorkspaceToolService(workspaces, profiles));
}

void serveStdio(createServer);
console.error("agent-workspace MCP server running on stdio");
