import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  type KeyObject
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { isPrincipalAllowed, type AuthenticatedPrincipal } from "./principal.js";
import type { RemoteOAuthConfig } from "./oauth-config.js";
import type { IdentityService } from "../persistence/identity-service.js";
import type { AuthorizationCodeRecord, OAuthClientRecord, OAuthStore, RefreshTokenRecord } from "./oauth-store.js";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

interface PendingSettingsLogin {
  kind: "settings";
  googleState: string;
  nonce: string;
  expiresAt: number;
}

interface PendingOAuthLogin {
  kind: "oauth";
  googleState: string;
  nonce: string;
  expiresAt: number;
  clientId: string;
  redirectUri: string;
  clientState?: string;
  scope: string;
  resource: string;
  codeChallenge: string;
}

type PendingLogin = PendingSettingsLogin | PendingOAuthLogin;

interface SettingsSession {
  principal: AuthenticatedPrincipal;
  csrf: string;
  expiresAt: number;
}

export interface AgentOAuthServerConfig {
  issuer: string;
  publicBaseUrl: string;
  mcpUrl: string;
  requiredScope: string;
  allowedEmails: readonly string[];
  googleClientId: string;
  googleClientSecret: string;
  signingKey: KeyObject;
  sessionSecret: string;
  clientMetadataOrigins: readonly string[];
}

export function loadAgentOAuthServerConfig(
  remote: RemoteOAuthConfig,
  env: NodeJS.ProcessEnv = process.env
): AgentOAuthServerConfig | undefined {
  const googleClientId = env.AGENT_WORKSPACE_GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.AGENT_WORKSPACE_GOOGLE_CLIENT_SECRET?.trim();
  const signingKeyEncoded = env.AGENT_WORKSPACE_AUTH_SIGNING_KEY?.trim();
  const sessionSecret = env.AGENT_WORKSPACE_WEB_SESSION_SECRET?.trim();

  if (!googleClientId && !googleClientSecret && !signingKeyEncoded && !sessionSecret) return undefined;
  if (!googleClientId || !googleClientSecret || !signingKeyEncoded || !sessionSecret) {
    throw new Error(
      "AGENT_WORKSPACE_GOOGLE_CLIENT_ID, AGENT_WORKSPACE_GOOGLE_CLIENT_SECRET, " +
      "AGENT_WORKSPACE_AUTH_SIGNING_KEY and AGENT_WORKSPACE_WEB_SESSION_SECRET must be configured together"
    );
  }
  if (sessionSecret.length < 32) {
    throw new Error("AGENT_WORKSPACE_WEB_SESSION_SECRET must be at least 32 characters");
  }

  let signingKey: KeyObject;
  try {
    signingKey = createPrivateKey({
      key: Buffer.from(signingKeyEncoded, "base64"),
      format: "der",
      type: "pkcs8"
    });
  } catch {
    throw new Error("AGENT_WORKSPACE_AUTH_SIGNING_KEY must be Base64 encoded PKCS#8 DER");
  }
  if (signingKey.asymmetricKeyType !== "ed25519") {
    throw new Error("AGENT_WORKSPACE_AUTH_SIGNING_KEY must contain an Ed25519 private key");
  }

  return {
    issuer: remote.issuer,
    publicBaseUrl: remote.publicBaseUrl,
    mcpUrl: remote.mcpUrl,
    requiredScope: remote.requiredScope,
    allowedEmails: remote.allowedEmails ?? [],
    googleClientId,
    googleClientSecret,
    signingKey,
    sessionSecret,
    clientMetadataOrigins: parseOrigins(env.AGENT_WORKSPACE_OAUTH_CLIENT_METADATA_ORIGINS)
  };
}

export class AgentOAuthServer {
  private readonly googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  private readonly publicKey: KeyObject;
  private readonly jwk: Record<string, unknown>;

  constructor(
    private readonly config: AgentOAuthServerConfig,
    private readonly store: OAuthStore,
    private readonly identityService: IdentityService,
    private readonly now: () => Date = () => new Date()
  ) {
    this.publicKey = createPublicKey(config.signingKey);
    this.jwk = {
      ...(this.publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "agent-workspace-1",
      alg: "EdDSA",
      use: "sig"
    };
  }

  authorizationServerMetadata() {
    return {
      issuer: this.config.issuer,
      authorization_endpoint: this.url("/authorize"),
      token_endpoint: this.url("/token"),
      registration_endpoint: this.url("/register"),
      jwks_uri: this.url("/jwks"),
      scopes_supported: [this.config.requiredScope],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
      ...(this.config.clientMetadataOrigins.length > 0
        ? { client_id_metadata_document_supported: true }
        : {})
    };
  }

  jwks() {
    return { keys: [this.jwk] };
  }

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return json(this.authorizationServerMetadata(), 200, { "access-control-allow-origin": "*" });
    }
    if (request.method === "GET" && url.pathname === "/jwks") {
      return json(this.jwks(), 200, {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300"
      });
    }
    if (request.method === "POST" && url.pathname === "/register") {
      return this.registerClient(request);
    }
    if (request.method === "GET" && url.pathname === "/authorize") {
      return this.beginAuthorization(url);
    }
    if (request.method === "GET" && url.pathname === "/auth/google/callback") {
      return this.completeGoogleLogin(request);
    }
    if (request.method === "POST" && url.pathname === "/token") {
      return this.token(request);
    }
    return undefined;
  }

  async beginSettingsLogin(): Promise<Response> {
    const pending: PendingSettingsLogin = {
      kind: "settings",
      googleState: randomToken(24),
      nonce: randomToken(24),
      expiresAt: Date.now() + 10 * 60_000
    };
    return this.redirectToGoogle(pending);
  }

  settingsSession(request: Request): { principal: AuthenticatedPrincipal; csrf: string } | undefined {
    const session = this.readSigned<SettingsSession>(cookieValue(request, "aw_session"));
    if (!session || session.expiresAt < Date.now()) return undefined;
    if (!isPrincipalAllowed(session.principal, this.config.allowedEmails)) return undefined;
    return { principal: session.principal, csrf: session.csrf };
  }

  logoutSettings(): Response {
    const headers = new Headers({ location: "/settings" });
    headers.append("set-cookie", cookie("aw_session", "", 0));
    return new Response(null, { status: 302, headers });
  }

  async verifyLocalAccessToken(token: string) {
    return jwtVerify(token, this.publicKey, {
      issuer: this.config.issuer,
      audience: this.config.mcpUrl
    });
  }

  private async registerClient(request: Request): Promise<Response> {
    let input: unknown;
    try { input = await request.json(); } catch { return oauthError("invalid_client_metadata", "Invalid JSON", 400); }
    if (!input || typeof input !== "object") return oauthError("invalid_client_metadata", "Invalid metadata", 400);
    const metadata = input as Record<string, unknown>;
    const redirectUris = stringArray(metadata.redirect_uris);
    if (redirectUris.length === 0 || redirectUris.some((uri) => !isSafeRedirectUri(uri))) {
      return oauthError("invalid_redirect_uri", "At least one valid redirect_uri is required", 400);
    }
    const authMethod = metadata.token_endpoint_auth_method;
    if (authMethod !== undefined && authMethod !== "none") {
      return oauthError("invalid_client_metadata", "Only public PKCE clients are supported", 400);
    }

    const clientId = `awc_${randomToken(24)}`;
    const record: OAuthClientRecord = {
      clientId,
      redirectUris,
      ...(typeof metadata.client_name === "string" && metadata.client_name.trim()
        ? { clientName: metadata.client_name.trim().slice(0, 200) }
        : {})
    };
    await this.store.registerClient(record);
    return json({
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: record.clientName,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"]
    }, 201, { "cache-control": "no-store" });
  }

  private async beginAuthorization(url: URL): Promise<Response> {
    if (url.searchParams.get("response_type") !== "code") {
      return oauthError("unsupported_response_type", "Only response_type=code is supported", 400);
    }
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const resource = url.searchParams.get("resource") ?? "";
    const scope = normalizeScope(url.searchParams.get("scope") ?? "");
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const challengeMethod = url.searchParams.get("code_challenge_method");

    if (!clientId || !redirectUri) return oauthError("invalid_request", "client_id and redirect_uri are required", 400);
    if (resource !== this.config.mcpUrl) return oauthError("invalid_target", "resource must be the MCP resource URL", 400);
    if (!scope.split(" ").includes(this.config.requiredScope)) {
      return oauthError("invalid_scope", "Required MCP scope is missing", 400);
    }
    if (!codeChallenge || challengeMethod !== "S256") {
      return oauthError("invalid_request", "PKCE S256 is required", 400);
    }

    const client = await this.resolveClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return oauthError("invalid_request", "Unknown client or redirect_uri", 400);
    }

    const pending: PendingOAuthLogin = {
      kind: "oauth",
      googleState: randomToken(24),
      nonce: randomToken(24),
      expiresAt: Date.now() + 10 * 60_000,
      clientId,
      redirectUri,
      ...(url.searchParams.get("state") ? { clientState: url.searchParams.get("state")! } : {}),
      scope,
      resource,
      codeChallenge
    };
    return this.redirectToGoogle(pending);
  }

  private redirectToGoogle(pending: PendingLogin): Response {
    const google = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    google.searchParams.set("client_id", this.config.googleClientId);
    google.searchParams.set("redirect_uri", this.url("/auth/google/callback"));
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("state", pending.googleState);
    google.searchParams.set("nonce", pending.nonce);
    google.searchParams.set("prompt", "select_account");

    const headers = new Headers({ location: google.toString() });
    headers.append("set-cookie", cookie("aw_auth_pending", this.sign(pending), 600));
    return new Response(null, { status: 302, headers });
  }

  private async completeGoogleLogin(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pending = this.readSigned<PendingLogin>(cookieValue(request, "aw_auth_pending"));
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!pending || pending.expiresAt < Date.now() || !code || state !== pending.googleState) {
      return new Response("Invalid or expired login state", { status: 400 });
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.config.googleClientId,
      client_secret: this.config.googleClientSecret,
      redirect_uri: this.url("/auth/google/callback")
    });
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) return new Response("Google token exchange failed", { status: 502 });
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) return new Response("Google did not return an id_token", { status: 502 });

    let payload;
    try {
      ({ payload } = await jwtVerify(tokens.id_token, this.googleJwks, {
        issuer: [GOOGLE_ISSUER, "accounts.google.com"],
        audience: this.config.googleClientId
      }));
    } catch {
      return new Response("Google identity token validation failed", { status: 502 });
    }
    if (!payload.sub || payload.nonce !== pending.nonce || payload.email_verified !== true) {
      return new Response("Google identity is incomplete or unverified", { status: 403 });
    }

    const principal: AuthenticatedPrincipal = {
      issuer: GOOGLE_ISSUER,
      subject: payload.sub,
      scopes: [],
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { displayName: payload.name } : {})
    };
    if (!isPrincipalAllowed(principal, this.config.allowedEmails)) {
      return new Response("Forbidden", { status: 403 });
    }

    const user = await this.identityService.resolveOrCreateUser({
      issuer: principal.issuer,
      subject: principal.subject,
      ...(principal.email ? { email: principal.email } : {}),
      ...(principal.displayName ? { displayName: principal.displayName } : {})
    });

    if (pending.kind === "settings") {
      const session: SettingsSession = {
        principal,
        csrf: randomToken(24),
        expiresAt: Date.now() + 8 * 60 * 60_000
      };
      const headers = new Headers({ location: "/settings" });
      headers.append("set-cookie", cookie("aw_session", this.sign(session), 8 * 60 * 60));
      headers.append("set-cookie", cookie("aw_auth_pending", "", 0));
      return new Response(null, { status: 302, headers });
    }

    const authorizationCode = randomToken(32);
    const record: AuthorizationCodeRecord = {
      codeHash: hashToken(authorizationCode),
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      userId: user.id,
      identityIssuer: principal.issuer,
      identitySubject: principal.subject,
      ...(principal.email ? { email: principal.email } : {}),
      ...(principal.displayName ? { displayName: principal.displayName } : {}),
      scope: pending.scope,
      resource: pending.resource,
      codeChallenge: pending.codeChallenge,
      expiresAt: new Date(this.now().getTime() + 5 * 60_000).toISOString()
    };
    await this.store.saveAuthorizationCode(record);

    const clientRedirect = new URL(pending.redirectUri);
    clientRedirect.searchParams.set("code", authorizationCode);
    if (pending.clientState) clientRedirect.searchParams.set("state", pending.clientState);
    clientRedirect.searchParams.set("iss", this.config.issuer);
    const headers = new Headers({ location: clientRedirect.toString() });
    headers.append("set-cookie", cookie("aw_auth_pending", "", 0));
    return new Response(null, { status: 302, headers });
  }

  private async token(request: Request): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return oauthError("invalid_request", "Token endpoint requires form encoding", 400);
    }
    const form = await request.formData();
    const grantType = String(form.get("grant_type") ?? "");
    if (grantType === "authorization_code") return this.exchangeAuthorizationCode(form);
    if (grantType === "refresh_token") return this.exchangeRefreshToken(form);
    return oauthError("unsupported_grant_type", "Unsupported grant_type", 400);
  }

  private async exchangeAuthorizationCode(form: FormData): Promise<Response> {
    const code = String(form.get("code") ?? "");
    const clientId = String(form.get("client_id") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    if (!code || !clientId || !redirectUri || !verifier) {
      return oauthError("invalid_request", "Missing authorization code parameters", 400);
    }

    const record = await this.store.consumeAuthorizationCode(hashToken(code));
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri) {
      return oauthError("invalid_grant", "Authorization code is invalid or expired", 400);
    }
    if (pkceChallenge(verifier) !== record.codeChallenge) {
      return oauthError("invalid_grant", "PKCE verification failed", 400);
    }
    const requestedResource = String(form.get("resource") ?? record.resource);
    if (requestedResource !== record.resource) return oauthError("invalid_target", "Resource mismatch", 400);
    return this.issueTokens(record);
  }

  private async exchangeRefreshToken(form: FormData): Promise<Response> {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const clientId = String(form.get("client_id") ?? "");
    if (!refreshToken || !clientId) return oauthError("invalid_request", "Missing refresh token parameters", 400);

    const record = await this.store.consumeRefreshToken(hashToken(refreshToken));
    if (!record || record.clientId !== clientId) {
      return oauthError("invalid_grant", "Refresh token is invalid or expired", 400);
    }
    const requestedResource = String(form.get("resource") ?? record.resource);
    if (requestedResource !== record.resource) return oauthError("invalid_target", "Resource mismatch", 400);
    return this.issueTokens(record);
  }

  private async issueTokens(
    record: Pick<AuthorizationCodeRecord,
      "clientId" | "userId" | "identityIssuer" | "identitySubject" | "email" | "displayName" | "scope" | "resource">
  ): Promise<Response> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const accessToken = await new SignJWT({
      scope: record.scope,
      client_id: record.clientId,
      identity_issuer: record.identityIssuer,
      identity_subject: record.identitySubject,
      ...(record.email ? { email: record.email } : {}),
      ...(record.displayName ? { name: record.displayName } : {})
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "agent-workspace-1", typ: "JWT" })
      .setIssuer(this.config.issuer)
      .setSubject(record.userId)
      .setAudience(record.resource)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 60 * 60)
      .sign(this.config.signingKey);

    const refreshToken = randomToken(48);
    const refreshRecord: RefreshTokenRecord = {
      tokenHash: hashToken(refreshToken),
      clientId: record.clientId,
      userId: record.userId,
      identityIssuer: record.identityIssuer,
      identitySubject: record.identitySubject,
      ...(record.email ? { email: record.email } : {}),
      ...(record.displayName ? { displayName: record.displayName } : {}),
      scope: record.scope,
      resource: record.resource,
      expiresAt: new Date(this.now().getTime() + 30 * 24 * 60 * 60_000).toISOString()
    };
    await this.store.saveRefreshToken(refreshRecord);

    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: record.scope
    }, 200, {
      "cache-control": "no-store",
      pragma: "no-cache"
    });
  }

  private async resolveClient(clientId: string): Promise<OAuthClientRecord | undefined> {
    const registered = await this.store.findClient(clientId);
    if (registered) return registered;
    if (!clientId.startsWith("https://")) return undefined;

    let url: URL;
    try { url = new URL(clientId); } catch { return undefined; }
    if (!this.config.clientMetadataOrigins.includes(url.origin)) return undefined;

    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
        headers: { accept: "application/json" }
      });
      if (!response.ok) return undefined;
      const metadata = await response.json() as Record<string, unknown>;
      const redirectUris = stringArray(metadata.redirect_uris);
      if (redirectUris.length === 0 || redirectUris.some((uri) => !isSafeRedirectUri(uri))) return undefined;
      return {
        clientId,
        redirectUris,
        ...(typeof metadata.client_name === "string" && metadata.client_name.trim()
          ? { clientName: metadata.client_name.trim().slice(0, 200) }
          : {})
      };
    } catch {
      return undefined;
    }
  }

  private url(path: string): string {
    return new URL(path, ensureTrailingSlash(this.config.publicBaseUrl)).toString();
  }

  private sign(value: unknown): string {
    const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.config.sessionSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private readSigned<T>(value: string | undefined): T | undefined {
    if (!value) return undefined;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return undefined;
    const expected = createHmac("sha256", this.config.sessionSecret).update(payload).digest();
    let actual: Buffer;
    try { actual = Buffer.from(signature, "base64url"); } catch { return undefined; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T; } catch { return undefined; }
  }
}

function normalizeScope(value: string): string {
  return [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))].join(" ");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const origins = new Set<string>();
  for (const raw of value.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const url = new URL(item);
    if (url.protocol !== "https:") throw new Error("OAuth client metadata origins must use https");
    origins.add(url.origin);
  }
  return [...origins];
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function json(value: unknown, status = 200, headersInit: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: headersInit });
}

function oauthError(error: string, description: string, status: number): Response {
  return json({ error, error_description: description }, status, { "cache-control": "no-store" });
}
