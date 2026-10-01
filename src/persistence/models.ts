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

export interface PersistedWorkspace extends Omit<Workspace, "providerId" | "providerWorkspaceId"> {
  userId: string;
  providerId?: string;
  providerWorkspaceId?: string;
}
