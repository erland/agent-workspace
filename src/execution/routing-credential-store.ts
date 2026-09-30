import type {
  ExecutionAccountCredentialStore,
  ModalExecutionCredentials,
  MutableExecutionAccountCredentialStore
} from "./execution-account.js";

export class RoutingExecutionAccountCredentialStore implements MutableExecutionAccountCredentialStore {
  constructor(
    private readonly environmentStore: ExecutionAccountCredentialStore,
    private readonly persistentStore: MutableExecutionAccountCredentialStore
  ) {}

  getModalCredentials(credentialRef: string): Promise<ModalExecutionCredentials> {
    return credentialRef.startsWith("env:")
      ? this.environmentStore.getModalCredentials(credentialRef)
      : this.persistentStore.getModalCredentials(credentialRef);
  }

  putModalToken(userId: string, tokenId: string, tokenSecret: string): Promise<string> {
    return this.persistentStore.putModalToken(userId, tokenId, tokenSecret);
  }

  async deleteCredentials(credentialRef: string): Promise<void> {
    if (!credentialRef.startsWith("env:")) {
      await this.persistentStore.deleteCredentials(credentialRef);
    }
  }
}
