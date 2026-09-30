import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AuthenticatedPrincipal } from "./principal.js";
import { isPrincipalAllowed } from "./principal.js";
import type { RemoteOAuthConfig } from "./oauth-config.js";

interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface LoginState {
  state: string;
  verifier: string;
  expiresAt: number;
}

interface SessionPayload {
  principal: AuthenticatedPrincipal;
  csrf: string;
  expiresAt: number;
}

export interface WebOidcConfig {
  issuer: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  sessionSecret: string;
  allowedEmails: readonly string[];
}

export function loadWebOidcConfig(
  oauth: RemoteOAuthConfig,
  env: NodeJS.ProcessEnv = process.env
): WebOidcConfig | undefined {
  const clientId = env.AGENT_WORKSPACE_WEB_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.AGENT_WORKSPACE_WEB_OIDC_CLIENT_SECRET?.trim();
  const sessionSecret = env.AGENT_WORKSPACE_WEB_SESSION_SECRET?.trim();
  if (!clientId && !sessionSecret) return undefined;
  if (!clientId || !sessionSecret) {
    throw new Error("AGENT_WORKSPACE_WEB_OIDC_CLIENT_ID and AGENT_WORKSPACE_WEB_SESSION_SECRET must be configured together");
  }
  if (sessionSecret.length < 32) {
    throw new Error("AGENT_WORKSPACE_WEB_SESSION_SECRET must be at least 32 characters");
  }
  return {
    issuer: oauth.issuer,
    jwksUri: oauth.jwksUri,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    redirectUri: new URL("/settings/callback", oauth.publicBaseUrl).toString(),
    sessionSecret,
    allowedEmails: oauth.allowedEmails ?? []
  };
}

export class WebOidcAuth {
  private discoveryPromise?: Promise<DiscoveryDocument>;
  private readonly jwks;

  constructor(private readonly config: WebOidcConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async beginLogin(): Promise<Response> {
    const discovery = await this.discovery();
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const loginState: LoginState = {
      state,
      verifier,
      expiresAt: Date.now() + 10 * 60_000
    };

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        "set-cookie": cookie("aw_login", this.sign(loginState), 600)
      }
    });
  }

  async completeLogin(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const login = this.readSigned<LoginState>(cookieValue(request, "aw_login"));
    if (!code || !state || !login || login.expiresAt < Date.now() || login.state !== state) {
      return new Response("Invalid or expired login state", { status: 400 });
    }

    const discovery = await this.discovery();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: login.verifier
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!tokenResponse.ok) return new Response("OIDC token exchange failed", { status: 502 });
    const token = await tokenResponse.json() as { id_token?: string };
    if (!token.id_token) return new Response("OIDC provider did not return an id_token", { status: 502 });

    const { payload } = await jwtVerify(token.id_token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.clientId
    });
    if (!payload.sub) return new Response("OIDC identity has no subject", { status: 403 });

    const principal: AuthenticatedPrincipal = {
      issuer: this.config.issuer,
      subject: payload.sub,
      scopes: [],
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { displayName: payload.name } : {})
    };
    if (!isPrincipalAllowed(principal, this.config.allowedEmails)) {
      return new Response("Forbidden", { status: 403 });
    }

    const session: SessionPayload = {
      principal,
      csrf: randomBytes(24).toString("base64url"),
      expiresAt: Date.now() + 8 * 60 * 60_000
    };
    return new Response(null, {
      status: 302,
      headers: {
        location: "/settings",
        "set-cookie": cookie("aw_session", this.sign(session), 8 * 60 * 60)
      }
    });
  }

  session(request: Request): { principal: AuthenticatedPrincipal; csrf: string } | undefined {
    const session = this.readSigned<SessionPayload>(cookieValue(request, "aw_session"));
    if (!session || session.expiresAt < Date.now()) return undefined;
    if (!isPrincipalAllowed(session.principal, this.config.allowedEmails)) return undefined;
    return { principal: session.principal, csrf: session.csrf };
  }

  logout(): Response {
    return new Response(null, {
      status: 302,
      headers: { location: "/settings", "set-cookie": cookie("aw_session", "", 0) }
    });
  }

  private async discovery(): Promise<DiscoveryDocument> {
    this.discoveryPromise ??= (async () => {
      const url = new URL(".well-known/openid-configuration", ensureTrailingSlash(this.config.issuer));
      const response = await fetch(url);
      if (!response.ok) throw new Error("OIDC discovery failed");
      const doc = await response.json() as Partial<DiscoveryDocument>;
      if (!doc.authorization_endpoint || !doc.token_endpoint) {
        throw new Error("OIDC discovery document is missing endpoints");
      }
      return doc as DiscoveryDocument;
    })();
    return this.discoveryPromise;
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
