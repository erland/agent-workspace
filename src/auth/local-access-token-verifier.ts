import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";

import { authInfoFromPayload } from "./jwt-access-token-verifier.js";
import type { AgentOAuthServer } from "./agent-oauth-server.js";

export class LocalAccessTokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly authServer: AgentOAuthServer) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await this.authServer.verifyLocalAccessToken(token);
      return authInfoFromPayload(token, payload);
    } catch (error) {
      const oauthError = new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired");
      oauthError.cause = error;
      throw oauthError;
    }
  }
}
