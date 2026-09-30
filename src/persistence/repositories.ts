import type {
  ExternalIdentityRecord,
  PersistedExecutionAccount,
  PersistedWorkspace,
  UserRecord
} from "./models.js";

export interface UserRepository {
  create(user: UserRecord): Promise<void>;
  findById(userId: string): Promise<UserRecord | undefined>;
  update(user: UserRecord): Promise<void>;
}

export interface ExternalIdentityRepository {
  create(identity: ExternalIdentityRecord): Promise<void>;
  findByIssuerSubject(issuer: string, subject: string): Promise<ExternalIdentityRecord | undefined>;
}

export interface ExecutionAccountRepository {
  upsert(account: PersistedExecutionAccount): Promise<void>;
  findByUserId(userId: string): Promise<PersistedExecutionAccount | undefined>;
}

export interface WorkspaceRepository {
  upsert(workspace: PersistedWorkspace): Promise<void>;
  findByIdForUser(workspaceId: string, userId: string): Promise<PersistedWorkspace | undefined>;
  listExpiredReady(nowIso: string, limit?: number): Promise<PersistedWorkspace[]>;
  countReadyForUser(userId: string): Promise<number>;
}


export interface EncryptedCredentialRecord {
  ref: string;
  userId: string;
  provider: "modal";
  iv: string;
  ciphertext: string;
  authTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedCredentialRepository {
  upsert(record: EncryptedCredentialRecord): Promise<void>;
  findByRef(ref: string): Promise<EncryptedCredentialRecord | undefined>;
  deleteByRef(ref: string): Promise<void>;
}
