import { randomUUID } from "node:crypto";

import type {
  ModalExecutionCredentials,
  MutableExecutionAccountCredentialStore
} from "./execution-account.js";
import type { ExecutionAccountRepository } from "../persistence/repositories.js";
import type { PersistedExecutionAccount } from "../persistence/models.js";

export interface ModalCredentialVerifier {
  verify(credentials: Extract<ModalExecutionCredentials, { kind: "token" }>): Promise<void>;
}

export interface ModalConnectionStatus {
  connected: boolean;
  updatedAt?: string;
}

export class ModalCredentialManager {
  constructor(
    private readonly executionAccounts: ExecutionAccountRepository,
    private readonly credentialStore: MutableExecutionAccountCredentialStore,
    private readonly verifier: ModalCredentialVerifier,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = () => `exa_${randomUUID()}`
  ) {}

  async status(userId: string): Promise<ModalConnectionStatus> {
    const account = await this.executionAccounts.findByUserId(userId);
    return account?.status === "CONNECTED"
      ? { connected: true, updatedAt: account.updatedAt }
      : { connected: false };
  }

  async saveAndTest(userId: string, tokenId: string, tokenSecret: string): Promise<void> {
    const credentials = { kind: "token", tokenId: tokenId.trim(), tokenSecret: tokenSecret.trim() } as const;
    if (!credentials.tokenId || !credentials.tokenSecret) throw new Error("Modal token id and secret are required");

    // Never persist unverified material.
    await this.verifier.verify(credentials);

    const existing = await this.executionAccounts.findByUserId(userId);
    const credentialRef = await this.credentialStore.putModalToken(userId, credentials.tokenId, credentials.tokenSecret);
    const now = this.now().toISOString();
    const account: PersistedExecutionAccount = {
      id: existing?.id ?? this.idFactory(),
      userId,
      provider: "modal",
      credentialRef,
      status: "CONNECTED",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.executionAccounts.upsert(account);
  }

  async test(userId: string): Promise<void> {
    const account = await this.requireConnected(userId);
    const credentials = await this.credentialStore.getModalCredentials(account.credentialRef);
    if (credentials.kind !== "token") throw new Error("Configured Modal credentials are not API token credentials");
    await this.verifier.verify(credentials);
  }

  async disconnect(userId: string): Promise<void> {
    const account = await this.executionAccounts.findByUserId(userId);
    if (!account) return;
    await this.credentialStore.deleteCredentials(account.credentialRef);
    await this.executionAccounts.upsert({
      ...account,
      status: "DISCONNECTED",
      updatedAt: this.now().toISOString()
    });
  }

  private async requireConnected(userId: string): Promise<PersistedExecutionAccount> {
    const account = await this.executionAccounts.findByUserId(userId);
    if (!account || account.status !== "CONNECTED") throw new Error("Modal is not connected");
    return account;
  }
}
