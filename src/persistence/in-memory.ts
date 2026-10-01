import type {
  ExecutionAccountRepository,
  ExternalIdentityRepository,
  UserRepository,
  WorkspaceRepository
} from "./repositories.js";
import type {
  ExternalIdentityRecord,
  PersistedExecutionAccount,
  PersistedWorkspace,
  UserRecord
} from "./models.js";

export class InMemoryUserRepository implements UserRepository {
  private readonly values = new Map<string, UserRecord>();

  async create(user: UserRecord): Promise<void> {
    if (this.values.has(user.id)) throw new Error(`User already exists: ${user.id}`);
    this.values.set(user.id, structuredClone(user));
  }

  async findById(userId: string): Promise<UserRecord | undefined> {
    const user = this.values.get(userId);
    return user ? structuredClone(user) : undefined;
  }

  async update(user: UserRecord): Promise<void> {
    if (!this.values.has(user.id)) throw new Error(`User not found: ${user.id}`);
    this.values.set(user.id, structuredClone(user));
  }
}

export class InMemoryExternalIdentityRepository implements ExternalIdentityRepository {
  private readonly byKey = new Map<string, ExternalIdentityRecord>();

  async create(identity: ExternalIdentityRecord): Promise<void> {
    const key = identityKey(identity.issuer, identity.subject);
    if (this.byKey.has(key)) throw new Error(`External identity already exists: ${key}`);
    this.byKey.set(key, structuredClone(identity));
  }

  async findByIssuerSubject(issuer: string, subject: string): Promise<ExternalIdentityRecord | undefined> {
    const value = this.byKey.get(identityKey(issuer, subject));
    return value ? structuredClone(value) : undefined;
  }
}

export class InMemoryExecutionAccountRepository implements ExecutionAccountRepository {
  private readonly byUser = new Map<string, PersistedExecutionAccount>();

  async upsert(account: PersistedExecutionAccount): Promise<void> {
    this.byUser.set(account.userId, structuredClone(account));
  }

  async findByUserId(userId: string): Promise<PersistedExecutionAccount | undefined> {
    const account = this.byUser.get(userId);
    return account ? structuredClone(account) : undefined;
  }
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly values = new Map<string, PersistedWorkspace>();

  async upsert(workspace: PersistedWorkspace): Promise<void> {
    this.values.set(workspace.id, structuredClone(workspace));
  }

  async reserveWorkspace(workspace: PersistedWorkspace, maxActiveWorkspaces: number): Promise<boolean> {
    const active = [...this.values.values()].filter(
      (value) =>
        value.userId === workspace.userId &&
        (value.status === "CREATING" || value.status === "READY")
    ).length;
    if (active >= maxActiveWorkspaces) return false;
    this.values.set(workspace.id, structuredClone(workspace));
    return true;
  }

  async findByIdForUser(workspaceId: string, userId: string): Promise<PersistedWorkspace | undefined> {
    const workspace = this.values.get(workspaceId);
    if (!workspace || workspace.userId !== userId) return undefined;
    return structuredClone(workspace);
  }

  async listExpiredActive(nowIso: string, limit = 100): Promise<PersistedWorkspace[]> {
    const now = Date.parse(nowIso);
    return [...this.values.values()]
      .filter((workspace) =>
        (workspace.status === "CREATING" || workspace.status === "READY") &&
        Date.parse(workspace.expiresAt) <= now
      )
      .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
      .slice(0, limit)
      .map((workspace) => structuredClone(workspace));
  }
}

function identityKey(issuer: string, subject: string): string {
  return `${issuer}\u0000${subject}`;
}
