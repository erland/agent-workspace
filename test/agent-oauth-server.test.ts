import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { AgentOAuthServer, type AgentOAuthServerConfig } from "../src/auth/agent-oauth-server.js";
import type {
  AuthorizationCodeRecord,
  OAuthClientRecord,
  OAuthStore,
  RefreshTokenRecord
} from "../src/auth/oauth-store.js";
import type { IdentityService } from "../src/persistence/identity-service.js";
import type { UserRateLimiter } from "../src/security/rate-limiter.js";

class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, OAuthClientRecord>();
  codes = new Map<string, AuthorizationCodeRecord>();
  refresh = new Map<string, RefreshTokenRecord>();
  rotated = new Map<string, number>();

  async registerClient(record: OAuthClientRecord) { this.clients.set(record.clientId, structuredClone(record)); }
  async findClient(clientId: string) { const x = this.clients.get(clientId); return x ? structuredClone(x) : undefined; }
  async saveAuthorizationCode(record: AuthorizationCodeRecord) { this.codes.set(record.codeHash, structuredClone(record)); }
  async consumeAuthorizationCode(codeHash: string) { const x = this.codes.get(codeHash); this.codes.delete(codeHash); return x ? structuredClone(x) : undefined; }
  async saveRefreshToken(record: RefreshTokenRecord) { this.refresh.set(record.tokenHash, structuredClone(record)); }
  async consumeRefreshToken(tokenHash: string, clientId: string, resource?: string) {
    const x = this.refresh.get(tokenHash);
    if (!x || x.clientId !== clientId || (resource && x.resource !== resource)) return undefined;
    const rotatedAt = this.rotated.get(tokenHash);
    if (rotatedAt && Date.now() - rotatedAt > 30_000) return undefined;
    this.rotated.set(tokenHash, rotatedAt ?? Date.now());
    return structuredClone(x);
  }
}

function server(store = new MemoryOAuthStore(), registrationRateLimiter?: UserRateLimiter) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const config: AgentOAuthServerConfig = {
    issuer: "https://workspace.example/",
    publicBaseUrl: "https://workspace.example/",
    mcpUrl: "https://workspace.example/mcp",
    requiredScope: "agent-workspace",
    allowedEmails: ["user@example.test"],
    googleClientId: "google-client",
    googleClientSecret: "google-secret",
    signingKey: privateKey,
    sessionSecret: "x".repeat(48),
    clientMetadataOrigins: []
  };
  const identityService = {} as IdentityService;
  return {
    auth: new AgentOAuthServer(
      config,
      store,
      identityService,
      () => new Date("2026-09-30T18:00:00Z"),
      registrationRateLimiter
    ),
    store
  };
}

describe("Agent Workspace OAuth server", () => {
  it("publishes OAuth metadata and JWKS for the MCP resource", async () => {
    const { auth } = server();
    const metadataResponse = await auth.handle(new Request("https://workspace.example/.well-known/oauth-authorization-server"));
    assert.equal(metadataResponse?.status, 200);
    const metadata = await metadataResponse!.json() as Record<string, unknown>;
    assert.equal(metadata.issuer, "https://workspace.example/");
    assert.equal(metadata.authorization_endpoint, "https://workspace.example/authorize");
    assert.equal(metadata.token_endpoint, "https://workspace.example/token");
    assert.equal(metadata.registration_endpoint, "https://workspace.example/register");
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);

    const jwksResponse = await auth.handle(new Request("https://workspace.example/jwks"));
    const jwks = await jwksResponse!.json() as { keys: Array<Record<string, unknown>> };
    assert.equal(jwks.keys.length, 1);
    assert.equal(jwks.keys[0]?.kty, "OKP");
    assert.equal(jwks.keys[0]?.crv, "Ed25519");
    assert.equal(jwks.keys[0]?.d, undefined);
  });

  it("dynamically registers public PKCE clients", async () => {
    const { auth, store } = server();
    const response = await auth.handle(new Request("https://workspace.example/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP test",
        redirect_uris: ["http://127.0.0.1:4567/callback"],
        token_endpoint_auth_method: "none"
      })
    }));
    assert.equal(response?.status, 201);
    const body = await response!.json() as { client_id: string; token_endpoint_auth_method: string };
    assert.match(body.client_id, /^awc_/);
    assert.equal(body.token_endpoint_auth_method, "none");
    assert.equal((await store.findClient(body.client_id))?.redirectUris[0], "http://127.0.0.1:4567/callback");
  });

  it("rejects registration metadata above configured bounds", async () => {
    const { auth } = server();

    const manyRedirects = await auth.handle(new Request("https://workspace.example/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: Array.from({ length: 11 }, (_, index) => "https://client.example/callback/" + index)
      })
    }));
    assert.equal(manyRedirects?.status, 400);

    const oversizedBody = await auth.handle(new Request("https://workspace.example/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        extra: "a".repeat(17000)
      })
    }));
    assert.equal(oversizedBody?.status, 413);
  });

  it("rate limits dynamic client registration independently", async () => {
    let calls = 0;
    const limiter: UserRateLimiter = {
      check() {
        calls += 1;
        if (calls > 1) throw new Error("limit");
      }
    };
    const { auth } = server(new MemoryOAuthStore(), limiter);
    const request = () => new Request("https://workspace.example/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://client.example/callback"] })
    });

    assert.equal((await auth.handle(request()))?.status, 201);
    assert.equal((await auth.handle(request()))?.status, 429);
  });

  it("requires resource binding and PKCE before redirecting to Google", async () => {
    const { auth, store } = server();
    await store.registerClient({ clientId: "client-1", redirectUris: ["https://client.example/callback"] });

    const invalid = await auth.handle(new Request(
      "https://workspace.example/authorize?response_type=code&client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=agent-workspace&code_challenge=x&code_challenge_method=S256"
    ));
    assert.equal(invalid?.status, 400);

    const validUrl = new URL("https://workspace.example/authorize");
    validUrl.searchParams.set("response_type", "code");
    validUrl.searchParams.set("client_id", "client-1");
    validUrl.searchParams.set("redirect_uri", "https://client.example/callback");
    validUrl.searchParams.set("scope", "agent-workspace");
    validUrl.searchParams.set("resource", "https://workspace.example/mcp");
    validUrl.searchParams.set("code_challenge", "challenge");
    validUrl.searchParams.set("code_challenge_method", "S256");
    validUrl.searchParams.set("state", "client-state");
    const valid = await auth.handle(new Request(validUrl));
    assert.equal(valid?.status, 302);
    assert.match(valid?.headers.get("location") ?? "", /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.match(valid?.headers.get("set-cookie") ?? "", /aw_auth_pending=/);
  });

  it("exchanges a one-time PKCE code for a resource-bound Agent Workspace token", async () => {
    const { auth, store } = server();
    const verifier = "verifier-value-with-sufficient-entropy-123456789";
    const code = "one-time-code";
    const codeHash = createHash("sha256").update(code).digest("hex");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await store.saveAuthorizationCode({
      codeHash,
      clientId: "client-1",
      redirectUri: "https://client.example/callback",
      userId: "usr-1",
      identityIssuer: "https://accounts.google.com",
      identitySubject: "google-subject-1",
      email: "user@example.test",
      displayName: "Test User",
      scope: "agent-workspace",
      resource: "https://workspace.example/mcp",
      codeChallenge: challenge,
      expiresAt: "2026-09-30T18:05:00.000Z"
    });

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "client-1",
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
      resource: "https://workspace.example/mcp"
    });
    const response = await auth.handle(new Request("https://workspace.example/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form
    }));
    assert.equal(response?.status, 200);
    const tokens = await response!.json() as { access_token: string; refresh_token: string };
    assert.ok(tokens.refresh_token);
    const verified = await auth.verifyLocalAccessToken(tokens.access_token);
    assert.equal(verified.payload.sub, "usr-1");
    assert.equal(verified.payload.aud, "https://workspace.example/mcp");
    assert.equal(verified.payload.identity_subject, "google-subject-1");
    assert.equal(verified.payload.email, "user@example.test");

    const replay = await auth.handle(new Request("https://workspace.example/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form
    }));
    assert.equal(replay?.status, 400);
  });
  it("logs refresh outcomes without exposing credentials", async () => {
    const { auth, store } = server();
    const token = "secret-refresh-token-test";
    const hash = createHash("sha256").update(token).digest("hex");
    await store.saveRefreshToken({
      tokenHash: hash, clientId: "client-1", userId: "usr-1",
      identityIssuer: "https://accounts.google.com", identitySubject: "sub-1",
      scope: "agent-workspace", resource: "https://workspace.example/mcp",
      expiresAt: "2026-10-30T18:00:00.000Z"
    });
    const logs: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      const refresh = (refresh_token: string) => auth.handle(new Request("https://workspace.example/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: "client-1", refresh_token })
      }));
      const [first, retry] = await Promise.all([refresh(token), refresh(token)]);
      assert.equal(first?.status, 200);
      assert.equal(retry?.status, 200);
      const firstBody = await first!.json() as { refresh_token: string };
      const retryBody = await retry!.json() as { refresh_token: string };
      assert.equal(firstBody.refresh_token, retryBody.refresh_token);
      const wrongClient = await auth.handle(new Request("https://workspace.example/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: "other-client", refresh_token: token })
      }));
      assert.equal(wrongClient?.status, 400);
      store.rotated.set(hash, Date.now() - 31_000);
      assert.equal((await refresh(token))?.status, 400);
      assert.deepEqual(logs.map(line => JSON.parse(line).outcome), ["success", "success", "rejected", "rejected"]);
      assert.deepEqual(logs.map(line => JSON.parse(line).reason), ["rotated_or_retried", "rotated_or_retried", "invalid_grant", "invalid_grant"]);
      assert.ok(logs.every(line => !line.includes(token) && !line.includes(hash)));
    } finally {
      console.info = original;
    }
  });

});
