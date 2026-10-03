import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { loadRemoteOAuthConfig } from "../auth/oauth-config.js";
import { JwtAccessTokenVerifier } from "../auth/jwt-access-token-verifier.js";
import {
  AgentOAuthServer,
  OAUTH_REGISTRATION_MAX_REQUEST_BYTES,
  loadAgentOAuthServerConfig
} from "../auth/agent-oauth-server.js";
import { LocalAccessTokenVerifier } from "../auth/local-access-token-verifier.js";
import { PostgresOAuthStore } from "../auth/oauth-store.js";
import { EnvironmentExecutionAccountCredentialStore } from "../execution/environment-credential-store.js";
import { EncryptedExecutionAccountCredentialStore } from "../execution/encrypted-credential-store.js";
import { RoutingExecutionAccountCredentialStore } from "../execution/routing-credential-store.js";
import { ModalCredentialManager } from "../execution/modal-credential-manager.js";
import { DefaultExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import { IdentityService } from "../persistence/identity-service.js";
import { createPostgresPool, PgSqlClient } from "../persistence/postgres/pool.js";
import {
  PostgresArtifactRepository,
  PostgresEncryptedCredentialRepository,
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
import { createSettingsHandler } from "../http/settings.js";
import { SandboxModalCredentialVerifier } from "../providers/modal/modal-credential-verifier.js";
import { LocalVolumeObjectStore } from "../storage/local-volume-object-store.js";
import { ArtifactDownloadSigner } from "../artifact/artifact-download.js";

const config = loadRemoteOAuthConfig();
const SERVICE_VERSION = process.env.npm_package_version ?? process.env.AGENT_WORKSPACE_VERSION ?? "unknown";
const MAX_HTTP_REQUEST_BYTES = 145 * 1024 * 1024;
const pool = createPostgresPool();
const db = new PgSqlClient(pool);
const users = new PostgresUserRepository(db);
const identities = new PostgresExternalIdentityRepository(db);
const executionAccounts = new PostgresExecutionAccountRepository(db);
const workspaces = new PostgresWorkspaceRepository(db);
const artifacts = new PostgresArtifactRepository(db);
const objectStore = new LocalVolumeObjectStore();
const artifactDownloadSigner = process.env.AGENT_WORKSPACE_ARTIFACT_SIGNING_KEY
  ? new ArtifactDownloadSigner(process.env.AGENT_WORKSPACE_ARTIFACT_SIGNING_KEY, config.publicBaseUrl)
  : undefined;
const encryptedCredentialRecords = new PostgresEncryptedCredentialRepository(db);
const identityService = new IdentityService(users, identities, executionAccounts);
const oauthStore = new PostgresOAuthStore(db);
const environmentCredentialStore = new EnvironmentExecutionAccountCredentialStore();
const persistentCredentialStore = process.env.AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY
  ? EncryptedExecutionAccountCredentialStore.fromEnvironment(encryptedCredentialRecords)
  : undefined;
const mutableCredentialStore = persistentCredentialStore
  ? new RoutingExecutionAccountCredentialStore(environmentCredentialStore, persistentCredentialStore)
  : undefined;
const executionCredentialStore = mutableCredentialStore ?? environmentCredentialStore;
const modalAppName = process.env.AGENT_WORKSPACE_MODAL_APP_NAME ?? "agent-workspace";
const providerFactory = new DefaultExecutionProviderFactory(
  executionCredentialStore,
  modalAppName
);
const authServerConfig = loadAgentOAuthServerConfig(config);
const authServer = authServerConfig
  ? new AgentOAuthServer(
      authServerConfig,
      oauthStore,
      identityService,
      () => new Date(),
      new InMemoryFixedWindowRateLimiter({
        limitPerMinute: DEFAULT_SECURITY_POLICY.oauthRegistrationRateLimitPerMinute
      })
    )
  : undefined;
const tokenVerifier = authServer
  ? new LocalAccessTokenVerifier(authServer)
  : new JwtAccessTokenVerifier(config);
const remote = createRemoteMcpHandler(config, tokenVerifier, {
  identityService,
  users,
  executionAccounts,
  workspaces,
  artifacts,
  objectStore,
  artifactDownloadSigner,
  providerFactory,
  rateLimiter: new InMemoryFixedWindowRateLimiter({ limitPerMinute: DEFAULT_SECURITY_POLICY.requestRateLimitPerMinute }),
  audit: new JsonLineAuditEventSink()
});

if (authServer && !mutableCredentialStore) {
  throw new Error("AGENT_WORKSPACE_CREDENTIAL_ENCRYPTION_KEY is required when Agent Workspace auth/settings are enabled");
}
const settingsHandler = authServer && mutableCredentialStore
  ? createSettingsHandler({
      auth: authServer,
      identityService,
      modalCredentials: new ModalCredentialManager(
        executionAccounts,
        mutableCredentialStore,
        new SandboxModalCredentialVerifier(modalAppName)
      )
    })
  : undefined;

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
    const authResponse = authServer ? await authServer.handle(request) : undefined;
    const settings = authResponse
      ? undefined
      : settingsHandler
        ? await settingsHandler(request)
        : (new URL(request.url).pathname.startsWith("/settings")
            ? new Response("Settings login is not configured", { status: 503 })
            : undefined);
    const artifactDownload = authResponse || settings ? undefined : await handleArtifactDownload(request);
    const health = authResponse || settings || artifactDownload ? undefined : await handleHealthRequest(request, {
      version: SERVICE_VERSION,
      checkDatabase: async () => { await pool.query("select 1"); }
    });
    const response = authResponse ?? settings ?? artifactDownload ?? health ?? await remote.fetch(request);
    res.statusCode = response.status;
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
    });
    if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
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

async function handleArtifactDownload(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const prefix = "/artifacts/download/";
  if (!url.pathname.startsWith(prefix)) return undefined;
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (!artifactDownloadSigner) return new Response("Artifact downloads are not configured", { status: 503 });

  try {
    const token = decodeURIComponent(url.pathname.slice(prefix.length));
    const payload = artifactDownloadSigner.verify(token);
    const artifact = await artifacts.findByIdForUser(payload.artifactId, payload.userId);
    if (!artifact || Date.parse(artifact.expiresAt) <= Date.now()) {
      return new Response("Artifact not found", { status: 404 });
    }
    const bytes = await objectStore.get(artifact.storageKey);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": artifact.mediaType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="${artifact.filename.replaceAll('"', '')}"`,
        "cache-control": "private, no-store"
      }
    });
  } catch {
    return new Response("Invalid or expired artifact download link", { status: 403 });
  }
}

async function toWebRequest(req: IncomingMessage, publicBaseUrl: string): Promise<Request> {
  const url = new URL(req.url ?? "/", publicBaseUrl);
  const maxRequestBytes =
    req.method === "POST" && url.pathname === "/register"
      ? OAUTH_REGISTRATION_MAX_REQUEST_BYTES
      : MAX_HTTP_REQUEST_BYTES;
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) throw new RequestBodyTooLargeError();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxRequestBytes) throw new RequestBodyTooLargeError();
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
