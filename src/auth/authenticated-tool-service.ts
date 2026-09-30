import { getCapabilities } from "../core/capabilities.js";
import type { ExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import type { ExecutionAccountRepository, UserRepository, WorkspaceRepository } from "../persistence/repositories.js";
import { IdentityService } from "../persistence/identity-service.js";
import { RepositoryProfileProvider } from "../persistence/profile-provider.js";
import type { ScreenshotViewport } from "../prototype/screenshot-service.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { normalizeToolError } from "../mcp/errors.js";
import type { ToolFailure, ToolResult } from "../mcp/tool-service.js";
import type { AuthenticatedPrincipal } from "./principal.js";
import type { UserRateLimiter } from "../security/rate-limiter.js";
import type { AuditEventSink } from "../audit/audit-events.js";

export interface AuthenticatedToolServiceDependencies {
  identityService: IdentityService;
  users: UserRepository;
  executionAccounts: ExecutionAccountRepository;
  workspaces: WorkspaceRepository;
  providerFactory: ExecutionProviderFactory;
  rateLimiter?: UserRateLimiter;
  audit?: AuditEventSink;
  now?: () => Date;
}

export class AuthenticatedAgentWorkspaceToolService {
  private userPromise?: ReturnType<IdentityService["resolveOrCreateUser"]>;

  constructor(
    private readonly principal: AuthenticatedPrincipal,
    private readonly deps: AuthenticatedToolServiceDependencies
  ) {}

  async getCapabilities(): Promise<ToolResult<ReturnType<typeof getCapabilities>>> {
    return { ok: true, result: getCapabilities() };
  }

  async getProfile(): Promise<ToolResult<unknown>> {
    try {
      const user = await this.user();
      const profile = new RepositoryProfileProvider(user.id, this.deps.users, this.deps.executionAccounts);
      return { ok: true, result: await profile.getProfile() };
    } catch (error) { return this.failure(error); }
  }

  async createWorkspace(input: { java?: "17"|"21"|"25"; node?: "20"|"22"; lifetimeMinutes?: number }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_create", undefined, (service) => {
      const runtime = input.java !== undefined || input.node !== undefined
        ? { ...(input.java ? { java: input.java } : {}), ...(input.node ? { node: input.node } : {}) }
        : undefined;
      return service.create({ ...(runtime ? { runtime } : {}), ...(input.lifetimeMinutes ? { lifetimeMinutes: input.lifetimeMinutes } : {}) });
    });
  }

  async uploadZip(input: { workspaceId: string; archiveBase64: string; filename?: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_upload_zip", input.workspaceId, async (service) => service.uploadZip(input.workspaceId, decodeBase64(input.archiveBase64)));
  }

  async verifyProject(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("project_verify", input.workspaceId, (service) => service.verifyProject(input.workspaceId));
  }

  async startPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("prototype_start", input.workspaceId, (service) => service.startPrototype(input.workspaceId));
  }

  async screenshotPrototype(input: { workspaceId: string; viewport?: ScreenshotViewport }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("prototype_screenshot", input.workspaceId, (service) => service.screenshotPrototype(input.workspaceId, input.viewport));
  }

  async destroyWorkspace(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_destroy", input.workspaceId, (service) => service.destroy(input.workspaceId));
  }

  private async withWorkspaceService<T>(action: string, workspaceId: string | undefined, operation: (service: WorkspaceService) => Promise<T>): Promise<ToolResult<T>> {
    let userId = "unknown";
    try {
      const user = await this.user();
      userId = user.id;
      this.deps.rateLimiter?.check(user.id, action);
      const account = await this.deps.identityService.getExecutionAccount(user.id);
      if (!account || account.status !== "CONNECTED") throw new Error("Execution account is not connected");
      const provider = await this.deps.providerFactory.createForAccount(account);
      const service = new WorkspaceService(provider, { userId: user.id, repository: this.deps.workspaces });
      const result = await operation(service);
      await this.audit(userId, action, "SUCCEEDED", undefined, workspaceId);
      return { ok: true, result };
    } catch (error) {
      await this.audit(userId, action, "FAILED", this.failure(error).error.code, workspaceId);
      return this.failure(error);
    }
  }

  private async audit(userId: string, action: string, outcome: "SUCCEEDED" | "FAILED", errorCode?: string, workspaceId?: string): Promise<void> {
    await this.deps.audit?.record({
      at: (this.deps.now ?? (() => new Date()))().toISOString(),
      userId,
      action,
      outcome,
      ...(workspaceId ? { workspaceId } : {}),
      ...(errorCode ? { errorCode } : {})
    });
  }

  private user() {
    this.userPromise ??= this.deps.identityService.resolveOrCreateUser({
      issuer: this.principal.issuer,
      subject: this.principal.subject,
      ...(this.principal.email ? { email: this.principal.email } : {}),
      ...(this.principal.displayName ? { displayName: this.principal.displayName } : {})
    });
    return this.userPromise;
  }

  private failure(error: unknown): ToolFailure {
    return { ok: false, ...normalizeToolError(error) };
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("archiveBase64 must be valid base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new Error("archiveBase64 decoded to an empty archive");
  return bytes;
}
