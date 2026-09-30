import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { loadRemoteOAuthConfig } from "../auth/oauth-config.js";
import { JwtAccessTokenVerifier } from "../auth/jwt-access-token-verifier.js";
import { EnvironmentExecutionAccountCredentialStore } from "../execution/environment-credential-store.js";
import { DefaultExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import { IdentityService } from "../persistence/identity-service.js";
import { createPostgresPool, PgSqlClient } from "../persistence/postgres/pool.js";
import {
  PostgresExecutionAccountRepository,
  PostgresExternalIdentityRepository,
  PostgresUserRepository,
  PostgresWorkspaceRepository
} from "../persistence/postgres/repositories.js";
import { createRemoteMcpHandler } from "./remote-handler.js";
import { InMemoryFixedWindowRateLimiter } from "../security/rate-limiter.js";
import { DEFAULT_SECURITY_POLICY } from "../security/security-policy.js";
import { JsonLineAuditEventSink } from "../audit/audit-events.js";
import { ExpiredWorkspaceCleanupJob } from "../workspace/expired-workspace-cleanup-job.js";
import { handleHealthRequest } from "../http/health.js";

const config = loadRemoteOAuthConfig();
const SERVICE_VERSION = process.env.npm_package_version ?? process.env.AGENT_WORKSPACE_VERSION ?? "unknown";
const MAX_HTTP_REQUEST_BYTES = 145 * 1024 * 1024;
const pool = createPostgresPool();
const db = new PgSqlClient(pool);
const users = new PostgresUserRepository(db);
const identities = new PostgresExternalIdentityRepository(db);
const executionAccounts = new PostgresExecutionAccountRepository(db);
const workspaces = new PostgresWorkspaceRepository(db);
const identityService = new IdentityService(users, identities, executionAccounts);
const providerFactory = new DefaultExecutionProviderFactory(
  new EnvironmentExecutionAccountCredentialStore(),
  process.env.AGENT_WORKSPACE_MODAL_APP_NAME ?? "agent-workspace"
);
const remote = createRemoteMcpHandler(config, new JwtAccessTokenVerifier(config), {
  identityService,
  users,
  executionAccounts,
  workspaces,
  providerFactory,
  rateLimiter: new InMemoryFixedWindowRateLimiter({ limitPerMinute: DEFAULT_SECURITY_POLICY.requestRateLimitPerMinute }),
  audit: new JsonLineAuditEventSink()
});

const cleanupJob = new ExpiredWorkspaceCleanupJob(workspaces, executionAccounts, providerFactory);
const cleanupTimer = setInterval(() => {
  void cleanupJob.run().then(({ processed, failed }) => {
    if (processed > 0) console.error(JSON.stringify({ type: "cleanup", processed, failed }));
  }).catch((error) => console.error("Workspace cleanup failed", error));
}, 60_000);
cleanupTimer.unref();

const server = createServer((req, res) => { void serve(req, res); });
server.listen(config.port, config.host, () => {
  console.error(`agent-workspace remote MCP listening on ${config.host}:${config.port}`);
});

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const request = await toWebRequest(req, config.publicBaseUrl);
    const health = await handleHealthRequest(request, {
      version: SERVICE_VERSION,
      checkDatabase: async () => { await pool.query("select 1"); }
    });
    const response = health ?? await remote.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = error instanceof RequestBodyTooLargeError ? 413 : 500;
    }
    res.end(error instanceof RequestBodyTooLargeError ? "Payload Too Large" : "Internal Server Error");
  }
}

async function toWebRequest(req: IncomingMessage, publicBaseUrl: string): Promise<Request> {
  const url = new URL(req.url ?? "/", publicBaseUrl);
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_REQUEST_BYTES) throw new RequestBodyTooLargeError();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_HTTP_REQUEST_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(bytes);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(url, {
    method: req.method ?? "GET",
    headers: toWebHeaders(req),
    ...(body ? { body } : {})
  });
}

function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

class RequestBodyTooLargeError extends Error {}

async function shutdown(): Promise<void> {
  clearInterval(cleanupTimer);
  await remote.close();
  await pool.end();
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
