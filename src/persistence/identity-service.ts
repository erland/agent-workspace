import { randomUUID } from "node:crypto";

import type {
  ExecutionAccountRepository,
  ExternalIdentityRepository,
  UserRepository
} from "./repositories.js";
import type { PersistedExecutionAccount, UserRecord } from "./models.js";

export interface ResolveIdentityRequest {
  issuer: string;
  subject: string;
  email?: string;
  displayName?: string;
}

export interface IdentityServiceOptions {
  now?: () => Date;
  idFactory?: (kind: "user" | "identity") => string;
}

export class IdentityService {
  private readonly now: () => Date;
  private readonly idFactory: (kind: "user" | "identity") => string;

  constructor(
    private readonly users: UserRepository,
    private readonly identities: ExternalIdentityRepository,
    private readonly executionAccounts: ExecutionAccountRepository,
    options: IdentityServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((kind) => `${kind === "user" ? "usr" : "idn"}_${randomUUID()}`);
  }

  async resolveOrCreateUser(request: ResolveIdentityRequest): Promise<UserRecord> {
    const existingIdentity = await this.identities.findByIssuerSubject(request.issuer, request.subject);
    if (existingIdentity) {
      const existingUser = await this.users.findById(existingIdentity.userId);
      if (!existingUser) throw new Error(`External identity references missing user: ${existingIdentity.userId}`);
      return existingUser;
    }

    const now = this.now().toISOString();
    const user: UserRecord = {
      id: this.idFactory("user"),
      ...(request.displayName ? { displayName: request.displayName } : {}),
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now
    };
    await this.users.create(user);
    await this.identities.create({
      id: this.idFactory("identity"),
      userId: user.id,
      issuer: request.issuer,
      subject: request.subject,
      ...(request.email ? { email: request.email } : {}),
      createdAt: now
    });
    return user;
  }

  async getExecutionAccount(userId: string): Promise<PersistedExecutionAccount | undefined> {
    return this.executionAccounts.findByUserId(userId);
  }

  async saveExecutionAccount(account: PersistedExecutionAccount): Promise<void> {
    if (account.userId.length === 0) throw new Error("Execution account requires userId");
    await this.executionAccounts.upsert(account);
  }
}
