import type {
  ExecutionAccountCredentialStore,
  ModalExecutionCredentials
} from "./execution-account.js";

export class RoutingExecutionAccountCredentialStore implements ExecutionAccountCredentialStore {
  constructor(
    private readonly environmentStore: ExecutionAccountCredentialStore,
    private readonly persistentStore: ExecutionAccountCredentialStore
  ) {}

  getModalCredentials(credentialRef: string): Promise<ModalExecutionCredentials> {
    return credentialRef.startsWith("env:")
      ? this.environmentStore.getModalCredentials(credentialRef)
      : this.persistentStore.getModalCredentials(credentialRef);
  }
}
