import type { ProfileProvider, AgentWorkspaceProfile } from "../mcp/profile.js";
import type { ExecutionAccountRepository, UserRepository } from "./repositories.js";

export class RepositoryProfileProvider implements ProfileProvider {
  constructor(
    private readonly userId: string,
    private readonly users: UserRepository,
    private readonly executionAccounts: ExecutionAccountRepository
  ) {}

  async getProfile(): Promise<AgentWorkspaceProfile> {
    const user = await this.users.findById(this.userId);
    if (!user) throw new Error(`User not found: ${this.userId}`);
    const account = await this.executionAccounts.findByUserId(this.userId);
    return {
      user: {
        id: user.id,
        ...(user.displayName ? { displayName: user.displayName } : {})
      },
      execution: {
        provider: "modal",
        connected: account?.status === "CONNECTED"
      }
    };
  }
}
