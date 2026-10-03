import { getCapabilities } from "../core/capabilities.js";
import type { ExecutionProviderFactory } from "../execution/execution-provider-factory.js";
import type { ArtifactRepository, ExecutionAccountRepository, UserRepository, WorkspaceRepository } from "../persistence/repositories.js";
import { IdentityService } from "../persistence/identity-service.js";
import { RepositoryProfileProvider } from "../persistence/profile-provider.js";
import type { ScreenshotViewport } from "../prototype/screenshot-service.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import {
  decodeBase64Archive,
  RemoteArchiveDownloader
} from "../mcp/archive-source.js";
import { normalizeToolError } from "../mcp/errors.js";
import type { ToolFailure, ToolResult, WorkspaceUploadZipToolInput } from "../mcp/tool-service.js";
import type { AuthenticatedPrincipal } from "./principal.js";
import type { UserRateLimiter } from "../security/rate-limiter.js";
import type { AuditEventSink } from "../audit/audit-events.js";
import { isModalAuthenticationError } from "../providers/modal/modal-auth-error.js";
import type { PersistedExecutionAccount } from "../persistence/models.js";
import type { ObjectStore } from "../storage/object-store.js";

export interface AuthenticatedToolServiceDependencies {
  identityService: IdentityService;
  users: UserRepository;
  executionAccounts: ExecutionAccountRepository;
  workspaces: WorkspaceRepository;
  artifacts: ArtifactRepository;
  objectStore: ObjectStore;
  providerFactory: ExecutionProviderFactory;
  rateLimiter?: UserRateLimiter;
  audit?: AuditEventSink;
  now?: () => Date;
  archiveDownloader?: RemoteArchiveDownloader;
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

  async uploadZip(input: WorkspaceUploadZipToolInput): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_upload_zip", input.workspaceId, async (service) => {
      const archive = input.archive
        ? await this.archiveDownloader().download(input.archive.download_url)
        : decodeBase64Archive(requireBase64(input.archiveBase64));
      return service.uploadZip(input.workspaceId, archive);
    });
  }

  async uploadZipFromUrl(input: { workspaceId: string; url: string; filename?: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_upload_zip_from_url", input.workspaceId, async (service) => {
      const archive = await this.archiveDownloader().download(input.url);
      return service.uploadZip(input.workspaceId, archive);
    });
  }

  async verifyProject(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("project_verify", input.workspaceId, (service) => service.verifyProject(input.workspaceId));
  }

  async buildProject(input: { workspaceId: string; outputs?: Array<{ path: string; name?: string; kind?: string }> }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService(
      "project_build",
      input.workspaceId,
      (service) => service.buildProject(input.workspaceId, input.outputs ?? [])
    );
  }

  async getArtifact(input: { artifactId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService(
      "artifact_get",
      undefined,
      (service) => service.getArtifact(input.artifactId)
    );
  }

  async readArtifact(input: { artifactId: string }): Promise<{ artifact: any; bytes: Uint8Array }> {
    const result = await this.withWorkspaceService(
      "artifact_resource",
      undefined,
      (service) => service.readArtifact(input.artifactId)
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }

  async startPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("prototype_start", input.workspaceId, (service) => service.startPrototype(input.workspaceId));
  }

  async previewPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService(
      "prototype_preview_link",
      input.workspaceId,
      (service) => service.prototypePreviewLink(input.workspaceId)
    );
  }

  async stopPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService(
      "prototype_stop",
      input.workspaceId,
      (service) => service.stopPrototype(input.workspaceId)
    );
  }

  async screenshotPrototype(input: { workspaceId: string; viewport?: ScreenshotViewport }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("prototype_screenshot", input.workspaceId, (service) => service.screenshotPrototype(input.workspaceId, input.viewport));
  }

  async readScreenshotArtifact(input: { workspaceId: string; artifactId: string }): Promise<Uint8Array> {
    const result = await this.withWorkspaceService(
      "prototype_screenshot_resource",
      input.workspaceId,
      (service) => service.readScreenshotArtifact(input.workspaceId, input.artifactId)
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.result;
  }

  async destroyWorkspace(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    return this.withWorkspaceService("workspace_destroy", input.workspaceId, (service) => service.destroy(input.workspaceId));
  }

  private archiveDownloader(): RemoteArchiveDownloader {
    return this.deps.archiveDownloader ?? new RemoteArchiveDownloader();
  }

  private async withWorkspaceService<T>(action: string, workspaceId: string | undefined, operation: (service: WorkspaceService) => Promise<T>): Promise<ToolResult<T>> {
    let userId = "unknown";
    let executionAccount: PersistedExecutionAccount | undefined;
    try {
      const user = await this.user();
      userId = user.id;
      this.deps.rateLimiter?.check(user.id, action);
      const account = await this.deps.identityService.getExecutionAccount(user.id);
      executionAccount = account;
      if (!account || account.status !== "CONNECTED") throw new Error("Execution account is not connected");
      const provider = await this.deps.providerFactory.createForAccount(account);
      const service = new WorkspaceService(provider, {
        userId: user.id,
        repository: this.deps.workspaces,
        artifactRepository: this.deps.artifacts,
        objectStore: this.deps.objectStore
      });
      const result = await operation(service);
      await this.audit(userId, action, "SUCCEEDED", undefined, workspaceId);
      return { ok: true, result };
    } catch (error) {
      if (executionAccount && isModalAuthenticationError(error)) {
        await this.deps.executionAccounts.upsert({
          ...executionAccount,
          status: "REVOKED",
          updatedAt: (this.deps.now ?? (() => new Date()))().toISOString()
        });
      }
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

function requireBase64(value: string | undefined): string {
  if (value === undefined) throw new Error("Exactly one of archive or archiveBase64 must be supplied");
  return value;
}
