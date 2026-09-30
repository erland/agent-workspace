import { createMcpHandler, requireBearerAuth, type AuthInfo } from "@modelcontextprotocol/server";

import { isPrincipalAllowed, principalFromAuthInfo } from "../auth/principal.js";
import { protectedResourceMetadata, protectedResourceMetadataUrl, type RemoteOAuthConfig } from "../auth/oauth-config.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { AuthenticatedAgentWorkspaceToolService, type AuthenticatedToolServiceDependencies } from "../auth/authenticated-tool-service.js";
import { createAgentWorkspaceMcpServer } from "./server.js";

export interface RemoteMcpHandler {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export function createRemoteMcpHandler(
  config: RemoteOAuthConfig,
  verifier: OAuthTokenVerifier,
  deps: AuthenticatedToolServiceDependencies
): RemoteMcpHandler {
  const metadataUrl = protectedResourceMetadataUrl(config);
  const gate = requireBearerAuth({ verifier, requiredScopes: [config.requiredScope], resourceMetadataUrl: metadataUrl });
  const handler = createMcpHandler(({ authInfo }) => {
    const principal = principalFromAuthInfo(authInfo);
    const tools = new AuthenticatedAgentWorkspaceToolService(principal, deps);
    return createAgentWorkspaceMcpServer(tools);
  }, { responseMode: "json" });

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.toString() === metadataUrl) {
        return Response.json(protectedResourceMetadata(config), {
          headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }
        });
      }
      if (url.pathname !== new URL(config.mcpUrl).pathname) return new Response("Not Found", { status: 404 });
      const auth = await gate(request);
      if (auth instanceof Response) return auth;
      const principal = principalFromAuthInfo(auth);
      if (!isPrincipalAllowed(principal, config.allowedEmails)) return new Response("Forbidden", { status: 403 });
      return handler.fetch(request, { authInfo: auth });
    },
    close: () => handler.close()
  };
}
