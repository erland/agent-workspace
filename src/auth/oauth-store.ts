import type { SqlClient } from "../persistence/postgres/sql-client.js";

export interface OAuthClientRecord {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
}

export interface AuthorizationCodeRecord {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  userId: string;
  scope: string;
  resource: string;
  codeChallenge: string;
  expiresAt: string;
}

export interface RefreshTokenRecord {
  tokenHash: string;
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  expiresAt: string;
}

export class PostgresOAuthStore {
  constructor(private readonly db: SqlClient, private readonly now: () => Date = () => new Date()) {}

  async registerClient(record: OAuthClientRecord): Promise<void> {
    await this.db.query(
      `insert into oauth_client (client_id, redirect_uris, client_name, created_at)
       values ($1, $2::jsonb, $3, $4)
       on conflict (client_id) do nothing`,
      [record.clientId, JSON.stringify(record.redirectUris), record.clientName ?? null, this.now().toISOString()]
    );
  }

  async findClient(clientId: string): Promise<OAuthClientRecord | undefined> {
    const result = await this.db.query<{
      client_id: string;
      redirect_uris: string[] | string;
      client_name: string | null;
    }>(
      `select client_id, redirect_uris, client_name from oauth_client where client_id = $1`,
      [clientId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const redirectUris = typeof row.redirect_uris === "string"
      ? JSON.parse(row.redirect_uris) as string[]
      : row.redirect_uris;
    return {
      clientId: row.client_id,
      redirectUris,
      ...(row.client_name ? { clientName: row.client_name } : {})
    };
  }

  async saveAuthorizationCode(record: AuthorizationCodeRecord): Promise<void> {
    await this.db.query(
      `insert into oauth_authorization_code
         (code_hash, client_id, redirect_uri, user_id, scope, resource, code_challenge, expires_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.codeHash,
        record.clientId,
        record.redirectUri,
        record.userId,
        record.scope,
        record.resource,
        record.codeChallenge,
        record.expiresAt,
        this.now().toISOString()
      ]
    );
  }

  async consumeAuthorizationCode(codeHash: string): Promise<AuthorizationCodeRecord | undefined> {
    const result = await this.db.query<{
      code_hash: string;
      client_id: string;
      redirect_uri: string;
      user_id: string;
      scope: string;
      resource: string;
      code_challenge: string;
      expires_at: string | Date;
    }>(
      `delete from oauth_authorization_code
       where code_hash = $1 and expires_at > now()
       returning code_hash, client_id, redirect_uri, user_id, scope, resource, code_challenge, expires_at`,
      [codeHash]
    );
    const row = result.rows[0];
    return row ? {
      codeHash: row.code_hash,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource,
      codeChallenge: row.code_challenge,
      expiresAt: toIso(row.expires_at)
    } : undefined;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.db.query(
      `insert into oauth_refresh_token
         (token_hash, client_id, user_id, scope, resource, expires_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.tokenHash,
        record.clientId,
        record.userId,
        record.scope,
        record.resource,
        record.expiresAt,
        this.now().toISOString()
      ]
    );
  }

  async consumeRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const result = await this.db.query<{
      token_hash: string;
      client_id: string;
      user_id: string;
      scope: string;
      resource: string;
      expires_at: string | Date;
    }>(
      `delete from oauth_refresh_token
       where token_hash = $1 and expires_at > now()
       returning token_hash, client_id, user_id, scope, resource, expires_at`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? {
      tokenHash: row.token_hash,
      clientId: row.client_id,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource,
      expiresAt: toIso(row.expires_at)
    } : undefined;
  }
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
