import type { ModalExecutionCredentials } from "../../execution/execution-account.js";

export interface ModalClientCredentialParams {
  tokenId?: string;
  tokenSecret?: string;
  oauthRefreshToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

function requireNonBlank(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`${field} must not be blank`);
  }
  return value;
}

export function modalClientParamsFromCredentials(
  credentials: ModalExecutionCredentials
): ModalClientCredentialParams {
  if (credentials.kind === "oauth") {
    return {
      oauthRefreshToken: requireNonBlank(credentials.refreshToken, "refreshToken"),
      oauthClientId: requireNonBlank(credentials.clientId, "clientId"),
      oauthClientSecret: requireNonBlank(credentials.clientSecret, "clientSecret")
    };
  }

  return {
    tokenId: requireNonBlank(credentials.tokenId, "tokenId"),
    tokenSecret: requireNonBlank(credentials.tokenSecret, "tokenSecret")
  };
}
