import type { AuthInfo } from "@modelcontextprotocol/server";

export interface AuthenticatedPrincipal {
  issuer: string;
  subject: string;
  scopes: string[];
  email?: string;
  displayName?: string;
}

export function principalFromAuthInfo(authInfo: AuthInfo | undefined): AuthenticatedPrincipal {
  if (!authInfo) throw new Error("Authenticated MCP request is required");
  const extra = authInfo.extra ?? {};
  const issuer = readNonEmptyString(extra.issuer, "authInfo.extra.issuer");
  const subject = readNonEmptyString(extra.subject, "authInfo.extra.subject");
  const email = typeof extra.email === "string" && extra.email.length > 0 ? extra.email : undefined;
  const displayName = typeof extra.displayName === "string" && extra.displayName.length > 0
    ? extra.displayName
    : undefined;
  return {
    issuer,
    subject,
    scopes: [...authInfo.scopes],
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function readNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
