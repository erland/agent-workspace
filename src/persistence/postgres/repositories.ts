import type {
  EncryptedCredentialRecord,
  EncryptedCredentialRepository,
  ExecutionAccountRepository,
  ExternalIdentityRepository,
  UserRepository,
  WorkspaceRepository
} from "../repositories.js";
import type {
  ExternalIdentityRecord,
  PersistedExecutionAccount,
  PersistedWorkspace,
  UserRecord
} from "../models.js";
import type { SqlClient } from "./sql-client.js";

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: SqlClient) {}

  async create(user: UserRecord): Promise<void> {
    await this.db.query(
      `insert into app_user (id, display_name, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5)`,
      [user.id, user.displayName ?? null, user.status, user.createdAt, user.updatedAt]
    );
  }

  async findById(userId: string): Promise<UserRecord | undefined> {
    const result = await this.db.query<UserRow>(
      `select id, display_name, status, created_at, updated_at from app_user where id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? mapUser(row) : undefined;
  }

  async update(user: UserRecord): Promise<void> {
    await this.db.query(
      `update app_user set display_name = $2, status = $3, updated_at = $4 where id = $1`,
      [user.id, user.displayName ?? null, user.status, user.updatedAt]
    );
  }
}

export class PostgresExternalIdentityRepository implements ExternalIdentityRepository {
  constructor(private readonly db: SqlClient) {}

  async create(identity: ExternalIdentityRecord): Promise<void> {
    await this.db.query(
      `insert into external_identity (id, user_id, issuer, subject, email, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [identity.id, identity.userId, identity.issuer, identity.subject, identity.email ?? null, identity.createdAt]
    );
  }

  async findByIssuerSubject(issuer: string, subject: string): Promise<ExternalIdentityRecord | undefined> {
    const result = await this.db.query<ExternalIdentityRow>(
      `select id, user_id, issuer, subject, email, created_at
       from external_identity where issuer = $1 and subject = $2`,
      [issuer, subject]
    );
    const row = result.rows[0];
    return row ? mapExternalIdentity(row) : undefined;
  }
}

export class PostgresExecutionAccountRepository implements ExecutionAccountRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(account: PersistedExecutionAccount): Promise<void> {
    await this.db.query(
      `insert into execution_account
         (id, user_id, provider, provider_account_id, credential_ref, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (user_id) do update set
         id = excluded.id,
         provider = excluded.provider,
         provider_account_id = excluded.provider_account_id,
         credential_ref = excluded.credential_ref,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      [
        account.id,
        account.userId,
        account.provider,
        account.providerAccountId ?? null,
        account.credentialRef,
        account.status,
        account.createdAt,
        account.updatedAt
      ]
    );
  }

  async findByUserId(userId: string): Promise<PersistedExecutionAccount | undefined> {
    const result = await this.db.query<ExecutionAccountRow>(
      `select id, user_id, provider, provider_account_id, credential_ref, status, created_at, updated_at
       from execution_account where user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? mapExecutionAccount(row) : undefined;
  }
}

export class PostgresEncryptedCredentialRepository implements EncryptedCredentialRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(record: EncryptedCredentialRecord): Promise<void> {
    await this.db.query(
      `insert into execution_credential
         (ref, user_id, provider, iv, ciphertext, auth_tag, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (ref) do update set
         user_id = excluded.user_id,
         provider = excluded.provider,
         iv = excluded.iv,
         ciphertext = excluded.ciphertext,
         auth_tag = excluded.auth_tag,
         updated_at = excluded.updated_at`,
      [
        record.ref,
        record.userId,
        record.provider,
        record.iv,
        record.ciphertext,
        record.authTag,
        record.createdAt,
        record.updatedAt
      ]
    );
  }

  async findByRef(ref: string): Promise<EncryptedCredentialRecord | undefined> {
    const result = await this.db.query<EncryptedCredentialRow>(
      `select ref, user_id, provider, iv, ciphertext, auth_tag, created_at, updated_at
       from execution_credential where ref = $1`,
      [ref]
    );
    const row = result.rows[0];
    return row ? {
      ref: row.ref,
      userId: row.user_id,
      provider: row.provider,
      iv: row.iv,
      ciphertext: row.ciphertext,
      authTag: row.auth_tag,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    } : undefined;
  }

  async deleteByRef(ref: string): Promise<void> {
    await this.db.query(`delete from execution_credential where ref = $1`, [ref]);
  }
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(workspace: PersistedWorkspace): Promise<void> {
    await this.db.query(
      `insert into workspace
         (id, user_id, provider_id, provider_workspace_id, runtime_profile, status,
          created_at, expires_at, destroyed_at, project_json, prototype_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       on conflict (id) do update set
         status = excluded.status,
         expires_at = excluded.expires_at,
         destroyed_at = excluded.destroyed_at,
         project_json = excluded.project_json,
         prototype_json = excluded.prototype_json`,
      [
        workspace.id,
        workspace.userId,
        workspace.providerId,
        workspace.providerWorkspaceId,
        workspace.runtimeProfile,
        workspace.status,
        workspace.createdAt,
        workspace.expiresAt,
        workspace.destroyedAt ?? null,
        workspace.project ? JSON.stringify(workspace.project) : null,
        workspace.prototype ? JSON.stringify(workspace.prototype) : null
      ]
    );
  }

  async findByIdForUser(workspaceId: string, userId: string): Promise<PersistedWorkspace | undefined> {
    const result = await this.db.query<WorkspaceRow>(
      `select id, user_id, provider_id, provider_workspace_id, runtime_profile, status,
              created_at, expires_at, destroyed_at, project_json, prototype_json
       from workspace where id = $1 and user_id = $2`,
      [workspaceId, userId]
    );
    const row = result.rows[0];
    return row ? mapWorkspace(row) : undefined;
  }

  async countReadyForUser(userId: string): Promise<number> {
    const result = await this.db.query<{ count: string | number }>(
      `select count(*) as count from workspace where user_id = $1 and status = 'READY'`,
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listExpiredReady(nowIso: string, limit = 100): Promise<PersistedWorkspace[]> {
    const result = await this.db.query<WorkspaceRow>(
      `select id, user_id, provider_id, provider_workspace_id, runtime_profile, status,
              created_at, expires_at, destroyed_at, project_json, prototype_json
       from workspace
       where status = 'READY' and expires_at <= $1
       order by expires_at asc
       limit $2`,
      [nowIso, limit]
    );
    return result.rows.map(mapWorkspace);
  }
}

type UserRow = {
  id: string; display_name: string | null; status: UserRecord["status"];
  created_at: string | Date; updated_at: string | Date;
};
type ExternalIdentityRow = {
  id: string; user_id: string; issuer: string; subject: string; email: string | null; created_at: string | Date;
};
type EncryptedCredentialRow = {
  ref: string; user_id: string; provider: "modal"; iv: string; ciphertext: string; auth_tag: string;
  created_at: string | Date; updated_at: string | Date;
};
type ExecutionAccountRow = {
  id: string; user_id: string; provider: "modal"; provider_account_id: string | null;
  credential_ref: string; status: PersistedExecutionAccount["status"]; created_at: string | Date; updated_at: string | Date;
};
type WorkspaceRow = {
  id: string; user_id: string; provider_id: string; provider_workspace_id: string;
  runtime_profile: PersistedWorkspace["runtimeProfile"]; status: PersistedWorkspace["status"];
  created_at: string | Date; expires_at: string | Date; destroyed_at: string | Date | null;
  project_json: NonNullable<PersistedWorkspace["project"]> | string | null;
  prototype_json: NonNullable<PersistedWorkspace["prototype"]> | string | null;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
function mapExternalIdentity(row: ExternalIdentityRow): ExternalIdentityRecord {
  return {
    id: row.id, userId: row.user_id, issuer: row.issuer, subject: row.subject,
    ...(row.email ? { email: row.email } : {}), createdAt: toIso(row.created_at)
  };
}
function mapExecutionAccount(row: ExecutionAccountRow): PersistedExecutionAccount {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    ...(row.provider_account_id ? { providerAccountId: row.provider_account_id } : {}),
    credentialRef: row.credential_ref,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
function parseJson<T>(value: T | string | null): T | undefined {
  if (value === null) return undefined;
  return typeof value === "string" ? JSON.parse(value) as T : value;
}
function mapWorkspace(row: WorkspaceRow): PersistedWorkspace {
  const project = parseJson<NonNullable<PersistedWorkspace["project"]>>(row.project_json);
  const prototype = parseJson<NonNullable<PersistedWorkspace["prototype"]>>(row.prototype_json);
  return {
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    providerWorkspaceId: row.provider_workspace_id,
    runtimeProfile: row.runtime_profile,
    status: row.status,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    ...(row.destroyed_at ? { destroyedAt: toIso(row.destroyed_at) } : {}),
    ...(project ? { project } : {}),
    ...(prototype ? { prototype } : {})
  };
}
