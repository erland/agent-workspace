import type { ExecutionAccountCredentialStore, ModalExecutionCredentials } from "./execution-account.js";

export class EnvironmentExecutionAccountCredentialStore implements ExecutionAccountCredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getModalCredentials(credentialRef: string): Promise<ModalExecutionCredentials> {
    if (!credentialRef.startsWith("env:")) throw new Error(`Unsupported credential ref: ${credentialRef}`);
    const key = credentialRef.slice(4).replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    const prefix = `AGENT_WORKSPACE_CREDENTIAL_${key}`;
    const refreshToken = this.env[`${prefix}_REFRESH_TOKEN`];
    const clientId = this.env[`${prefix}_CLIENT_ID`];
    const clientSecret = this.env[`${prefix}_CLIENT_SECRET`];
    if (refreshToken && clientId && clientSecret) {
      return { kind: "oauth", refreshToken, clientId, clientSecret };
    }
    const tokenId = this.env[`${prefix}_TOKEN_ID`];
    const tokenSecret = this.env[`${prefix}_TOKEN_SECRET`];
    if (tokenId && tokenSecret) return { kind: "token", tokenId, tokenSecret };
    throw new Error(`Credentials are not configured for ref: ${credentialRef}`);
  }
}
