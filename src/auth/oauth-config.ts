export interface RemoteOAuthConfig {
  publicBaseUrl: string;
  mcpUrl: string;
  issuer: string;
  audience: string;
  jwksUri: string;
  requiredScope: string;
  allowedEmails?: string[];
  port: number;
  host: string;
}

export function loadRemoteOAuthConfig(env: NodeJS.ProcessEnv = process.env): RemoteOAuthConfig {
  const publicBaseUrl = requiredUrl(env.AGENT_WORKSPACE_PUBLIC_BASE_URL, "AGENT_WORKSPACE_PUBLIC_BASE_URL");
  const issuer = env.AGENT_WORKSPACE_OAUTH_ISSUER
    ? requiredUrl(env.AGENT_WORKSPACE_OAUTH_ISSUER, "AGENT_WORKSPACE_OAUTH_ISSUER")
    : publicBaseUrl;
  const mcpUrl = new URL("/mcp", ensureTrailingSlash(publicBaseUrl)).toString();
  return {
    publicBaseUrl,
    mcpUrl,
    issuer,
    audience: env.AGENT_WORKSPACE_OAUTH_AUDIENCE ?? mcpUrl,
    jwksUri: env.AGENT_WORKSPACE_OAUTH_JWKS_URI
      ? requiredUrl(env.AGENT_WORKSPACE_OAUTH_JWKS_URI, "AGENT_WORKSPACE_OAUTH_JWKS_URI")
      : new URL("/jwks", ensureTrailingSlash(publicBaseUrl)).toString(),
    requiredScope: env.AGENT_WORKSPACE_OAUTH_SCOPE ?? "agent-workspace",
    allowedEmails: parseEmailAllowlist(env.AGENT_WORKSPACE_ALLOWED_EMAILS),
    port: positiveInteger(env.PORT, 3000, "PORT"),
    host: env.HOST ?? "0.0.0.0"
  };
}

export function protectedResourceMetadata(config: RemoteOAuthConfig) {
  return {
    resource: config.mcpUrl,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope],
    bearer_methods_supported: ["header"]
  };
}

export function protectedResourceMetadataUrl(config: RemoteOAuthConfig): string {
  const mcp = new URL(config.mcpUrl);
  return new URL(`/.well-known/oauth-protected-resource${mcp.pathname}`, config.publicBaseUrl).toString();
}

function requiredUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`${name} must use https outside localhost`);
  }
  return url.toString();
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) throw new Error(`${name} must be a valid port`);
  return parsed;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseEmailAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
