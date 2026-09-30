export interface AgentWorkspaceProfile {
  user: {
    id: string;
    displayName?: string;
  };
  execution: {
    provider: "modal";
    connected: boolean;
  };
}

export interface ProfileProvider {
  getProfile(): Promise<AgentWorkspaceProfile>;
}

export class StaticProfileProvider implements ProfileProvider {
  public constructor(private readonly profile: AgentWorkspaceProfile) {}
  public async getProfile(): Promise<AgentWorkspaceProfile> {
    return structuredClone(this.profile);
  }
}

export function developmentProfileFromEnv(env: NodeJS.ProcessEnv = process.env): AgentWorkspaceProfile {
  return {
    user: {
      id: env.AGENT_WORKSPACE_USER_ID ?? "dev-user",
      ...(env.AGENT_WORKSPACE_DISPLAY_NAME ? { displayName: env.AGENT_WORKSPACE_DISPLAY_NAME } : {})
    },
    execution: { provider: "modal", connected: true }
  };
}
