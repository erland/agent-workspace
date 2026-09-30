export type ExecutionProviderId = "modal";

export type ExecutionAccountStatus = "CONNECTED" | "DISCONNECTED" | "REVOKED";

export interface ExecutionAccount {
  id: string;
  userId: string;
  provider: ExecutionProviderId;
  providerAccountId?: string;
  credentialRef: string;
  status: ExecutionAccountStatus;
}

export interface ExecutionAccountCredentialStore {
  getModalCredentials(credentialRef: string): Promise<ModalExecutionCredentials>;
}

export type ModalExecutionCredentials =
  | {
      kind: "oauth";
      refreshToken: string;
      clientId: string;
      clientSecret: string;
    }
  | {
      kind: "token";
      tokenId: string;
      tokenSecret: string;
    };

export class InMemoryExecutionAccountCredentialStore
  implements ExecutionAccountCredentialStore
{
  private readonly credentials = new Map<string, ModalExecutionCredentials>();

  public put(ref: string, credentials: ModalExecutionCredentials): void {
    this.credentials.set(ref, structuredClone(credentials));
  }

  public async getModalCredentials(
    credentialRef: string
  ): Promise<ModalExecutionCredentials> {
    const credentials = this.credentials.get(credentialRef);
    if (!credentials) {
      throw new Error(`Credentials not found for execution account ref: ${credentialRef}`);
    }
    return structuredClone(credentials);
  }
}
