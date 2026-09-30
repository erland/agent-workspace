import type { SandboxProvider } from "../core/sandbox-provider.js";
import { ModalSandboxProvider } from "../providers/modal/modal-sandbox-provider.js";
import type {
  ExecutionAccount,
  ExecutionAccountCredentialStore
} from "./execution-account.js";

export interface ExecutionProviderFactory {
  createForAccount(account: ExecutionAccount): Promise<SandboxProvider>;
}

export class DefaultExecutionProviderFactory implements ExecutionProviderFactory {
  public constructor(
    private readonly credentialStore: ExecutionAccountCredentialStore,
    private readonly modalAppName: string
  ) {}

  public async createForAccount(account: ExecutionAccount): Promise<SandboxProvider> {
    if (account.status !== "CONNECTED") {
      throw new Error(`Execution account ${account.id} is not connected`);
    }

    switch (account.provider) {
      case "modal": {
        const credentials = await this.credentialStore.getModalCredentials(
          account.credentialRef
        );
        return new ModalSandboxProvider({
          appName: this.modalAppName,
          credentials
        });
      }
    }
  }
}
