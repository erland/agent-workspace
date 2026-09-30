import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";

import { createRemoteMcpHandler } from "../mcp/remote-handler.js";
import { IdentityService } from "../persistence/identity-service.js";
import {
  InMemoryExecutionAccountRepository,
  InMemoryExternalIdentityRepository,
  InMemoryUserRepository,
  InMemoryWorkspaceRepository
} from "../persistence/in-memory.js";
import type { ExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import type { SandboxProvider } from "../core/sandbox-provider.js";

class StaticVerifier implements OAuthTokenVerifier {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token !== "alice-token" && token !== "bob-token") throw new Error("invalid token");
    const subject = token === "alice-token" ? "alice" : "bob";
    return {
      token,
      clientId: "smoke-client",
      scopes: ["agent-workspace"],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      extra: { issuer: "https://smoke.identity.example/", subject }
    };
  }
}

class NeverUsedProviderFactory implements ExecutionProviderFactory {
  async createForAccount(): Promise<SandboxProvider> {
    throw new Error("Execution provider should not be needed for profile smoke");
  }
}

const users = new InMemoryUserRepository();
const identities = new InMemoryExternalIdentityRepository();
const executionAccounts = new InMemoryExecutionAccountRepository();
const workspaces = new InMemoryWorkspaceRepository();
let userNo = 0;
const identityService = new IdentityService(users, identities, executionAccounts, {
  idFactory: (kind) => kind === "user" ? `usr-smoke-${++userNo}` : `idn-smoke-${userNo}`
});
const publicBaseUrl = "http://127.0.0.1:43191/";
const config = {
  publicBaseUrl,
  mcpUrl: `${publicBaseUrl}mcp`,
  issuer: "https://smoke.identity.example/",
  audience: `${publicBaseUrl}mcp`,
  jwksUri: "https://smoke.identity.example/jwks",
  requiredScope: "agent-workspace",
  port: 43191,
  host: "127.0.0.1"
};
const handler = createRemoteMcpHandler(config, new StaticVerifier(), {
  identityService, users, executionAccounts, workspaces, providerFactory: new NeverUsedProviderFactory()
});
const server = createServer((req, res) => { void serve(req, res); });
await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));

try {
  const unauthenticated = await fetch(config.mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (unauthenticated.status !== 401) throw new Error(`Expected unauthenticated 401, got ${unauthenticated.status}`);

  const alice = await profileFor("alice-token");
  const bob = await profileFor("bob-token");
  if (alice === bob) throw new Error("Distinct identities resolved to the same Agent Workspace user");
  console.log(`alice => ${alice}`);
  console.log(`bob   => ${bob}`);
  console.log("Unauthenticated request => 401");
  console.log("Remote MCP auth smoke PASSED");
} finally {
  await handler.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function profileFor(token: string): Promise<string> {
  const client = new Client({ name: "agent-workspace-auth-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "get_profile", arguments: {} });
    const text = result.content.find((part: any) => part.type === "text") as any;
    const parsed = JSON.parse(text.text);
    return parsed.result.user.id;
  } finally {
    await client.close();
  }
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", publicBaseUrl);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const request = new Request(url, {
    method: req.method ?? "GET",
    headers,
    ...(body ? { body } : {})
  });
  const response = await handler.fetch(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) Readable.fromWeb(response.body as never).pipe(res);
  else res.end();
}
