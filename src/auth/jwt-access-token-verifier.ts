import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { RemoteOAuthConfig } from "./oauth-config.js";

export class JwtAccessTokenVerifier implements OAuthTokenVerifier {
  private readonly jwks;

  constructor(private readonly config: RemoteOAuthConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience
      });
      return authInfoFromPayload(token, payload);
    } catch (error) {
      const oauthError = new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired");
      oauthError.cause = error;
      throw oauthError;
    }
  }
}

export function authInfoFromPayload(token: string, payload: JWTPayload): AuthInfo {
  if (!payload.sub) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has no subject");
  if (!payload.iss) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has no issuer");
  if (!payload.exp) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has no expiry");
  const scopes = extractScopes(payload);
  const clientId = firstString(payload.azp, payload.client_id, payload.sub) ?? payload.sub;
  return {
    token,
    clientId,
    scopes,
    expiresAt: payload.exp,
    extra: {
      issuer: typeof payload.identity_issuer === "string" ? payload.identity_issuer : payload.iss,
      subject: typeof payload.identity_subject === "string" ? payload.identity_subject : payload.sub,
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { displayName: payload.name } : {})
    }
  };
}

function extractScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((value): value is string => typeof value === "string");
  return [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
