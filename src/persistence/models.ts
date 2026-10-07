import type { ExecutionAccount } from "../execution/execution-account.js";
import type { Workspace } from "../workspace/workspace-service.js";

export type UserStatus = "ACTIVE" | "DISABLED";

export interface UserRecord {
  id: string;
  displayName?: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIdentityRecord {
  id: string;
  userId: string;
  issuer: string;
  subject: string;
  email?: string;
  createdAt: string;
}

export interface PersistedExecutionAccount extends ExecutionAccount {
  createdAt: string;
  updatedAt: string;
}

export interface PersistedWorkspace extends Workspace {
  userId: string;
}


export interface ArtifactRecord {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  kind: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
  expiresAt: string;
}
