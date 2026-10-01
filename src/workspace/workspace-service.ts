import { randomUUID } from "node:crypto";
import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from "../security/security-policy.js";
import { redactSensitiveText } from "../security/redaction.js";

import {
  validateZipArchive,
  type ArchiveValidationLimits,
  type ArchiveValidationResult
} from "../archive/archive-validator.js";
import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import type { WorkspaceRepository } from "../persistence/repositories.js";
import type { PersistedWorkspace } from "../persistence/models.js";
import { NpmVerifier } from "../verification/npm-verifier.js";
import { MavenVerifier } from "../verification/maven-verifier.js";
import type { ProjectVerificationResult } from "../verification/verification-result.js";
import { PrototypeService, type PrototypeStartResult } from "../prototype/prototype-service.js";
import { ScreenshotService, type PrototypeScreenshotResult, type ScreenshotViewport } from "../prototype/screenshot-service.js";
import { analyzeProjectArchive, type ProjectAnalysis } from "../project/project-detector.js";
import {
  resolveRuntimeProfile,
  type RuntimeProfileId,
  type RuntimeRequest
} from "../core/runtime-profile.js";

export type WorkspaceStatus = "CREATING" | "READY" | "DESTROYED" | "EXPIRED";

export interface WorkspaceProject {
  uploadedAt: string;
  analysis: ProjectAnalysis;
  archive: {
    entryCount: number;
    totalCompressedBytes: number;
    totalUncompressedBytes: number;
  };
}

export interface WorkspacePrototype {
  status: "RUNNING";
  strategy: "dev" | "start" | "preview";
  port: number;
  url: string;
  processId: number;
  startedAt: string;
}

export interface Workspace {
  id: string;
  userId: string;
  providerId: string;
  providerWorkspaceId: string;
  runtimeProfile: RuntimeProfileId;
  status: WorkspaceStatus;
  createdAt: string;
  expiresAt: string;
  destroyedAt?: string;
  project?: WorkspaceProject;
  prototype?: WorkspacePrototype;
}

export interface CreateWorkspaceRequest {
  runtime?: RuntimeRequest;
  lifetimeMinutes?: number;
}

export interface UploadZipResult {
  workspace: Workspace;
  validation: ArchiveValidationResult;
}

export interface WorkspaceServiceOptions {
  defaultLifetimeMinutes?: number;
  maxLifetimeMinutes?: number;
  archiveLimits?: Partial<ArchiveValidationLimits>;
  now?: () => Date;
  idFactory?: () => string;
  schedule?: (callback: () => void, delayMs: number) => { unref?: () => void };
  userId?: string;
  repository?: WorkspaceRepository;
  securityPolicy?: SecurityPolicy;
}

interface WorkspaceRecord {
  workspace: Workspace;
  handle: WorkspaceHandle;
  expiryTimer?: { unref?: () => void };
}

const DEFAULT_LIFETIME_MINUTES = 30;
const MAX_LIFETIME_MINUTES = 60;

export class WorkspaceService {
  private readonly records = new Map<string, WorkspaceRecord>();
  private readonly localReservations = new Set<string>();
  private readonly defaultLifetimeMinutes: number;
  private readonly maxLifetimeMinutes: number;
  private readonly archiveLimits: Partial<ArchiveValidationLimits>;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly schedule: WorkspaceServiceOptions["schedule"];
  private readonly userId: string;
  private readonly repository: WorkspaceRepository | undefined;
  private readonly securityPolicy: SecurityPolicy;

  public constructor(
    private readonly provider: SandboxProvider,
    options: WorkspaceServiceOptions = {}
  ) {
    this.defaultLifetimeMinutes = options.defaultLifetimeMinutes ?? DEFAULT_LIFETIME_MINUTES;
    this.maxLifetimeMinutes = options.maxLifetimeMinutes ?? options.securityPolicy?.maxWorkspaceLifetimeMinutes ?? MAX_LIFETIME_MINUTES;
    this.archiveLimits = options.archiveLimits ?? {};
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `ws_${randomUUID()}`);
    this.userId = options.userId ?? "dev-user";
    this.repository = options.repository;
    this.securityPolicy = options.securityPolicy ?? DEFAULT_SECURITY_POLICY;
    this.schedule =
      options.schedule ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        timer.unref();
        return timer;
      });
  }

  public async create(request: CreateWorkspaceRequest = {}): Promise<Workspace> {
    await this.cleanupExpired();
    const profile = resolveRuntimeProfile(request.runtime);
    const lifetimeMinutes = request.lifetimeMinutes ?? this.defaultLifetimeMinutes;
    this.validateLifetime(lifetimeMinutes);

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + lifetimeMinutes * 60_000);
    const workspaceId = this.idFactory();
    const reservation: PersistedWorkspace = {
      id: workspaceId,
      userId: this.userId,
      runtimeProfile: profile.id,
      status: "CREATING",
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    const reserved = await this.reserveWorkspace(reservation);
    if (!reserved) {
      throw new Error(
        `User active workspace limit exceeded (${this.securityPolicy.maxActiveWorkspacesPerUser})`
      );
    }

    let handle: WorkspaceHandle | undefined;
    let workspace: Workspace | undefined;
    let providerAttached = false;

    try {
      handle = await this.provider.createWorkspace({
        imageRef: profile.imageRef,
        timeoutMs: lifetimeMinutes * 60_000,
        cpu: this.securityPolicy.workspaceCpu,
        cpuLimit: this.securityPolicy.workspaceCpuLimit,
        memoryMiB: this.securityPolicy.workspaceMemoryMiB,
        networkPolicy: this.securityPolicy.networkPolicy
      });

      workspace = {
        ...reservation,
        providerId: handle.providerId,
        providerWorkspaceId: handle.providerWorkspaceId
      };

      await this.persist(workspace);
      providerAttached = true;
      this.localReservations.delete(workspaceId);
      this.records.set(workspaceId, { workspace, handle });

      for (const command of profile.bootstrapCommands) {
        const result = await this.provider.exec(handle, command);
        if (result.exitCode !== 0) {
          throw new Error(
            `Runtime bootstrap failed for ${profile.id}: ${redactSensitiveText(result.stderr || result.stdout)}`
          );
        }
      }

      workspace.status = "READY";
      await this.persist(workspace);

      const expiryTimer = this.schedule?.(() => {
        void this.expire(workspaceId);
      }, lifetimeMinutes * 60_000);
      expiryTimer?.unref?.();
      const record = this.records.get(workspaceId);
      if (record && expiryTimer !== undefined) record.expiryTimer = expiryTimer;

      return cloneWorkspace(workspace);
    } catch (error) {
      if (handle) {
        await this.provider.terminate(handle).catch(() => undefined);
      }

      if (providerAttached && workspace) {
        workspace.status = "DESTROYED";
        workspace.destroyedAt = this.now().toISOString();
        await this.persist(workspace).catch(() => undefined);
        this.records.delete(workspaceId);
      } else {
        await this.releaseReservation(workspaceId).catch(() => undefined);
      }

      this.localReservations.delete(workspaceId);
      throw error;
    }
  }

  public async get(workspaceId: string): Promise<Workspace> {
    const record = await this.requireRecord(workspaceId);
    if (record.workspace.status === "READY" && this.isExpired(record.workspace)) {
      await this.expire(workspaceId);
    }
    return cloneWorkspace(record.workspace);
  }

  public async uploadZip(workspaceId: string, archive: Uint8Array): Promise<UploadZipResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for upload: ${workspace.status}`);
    }

    const validation = validateZipArchive(archive, this.archiveLimits);
    const analysis = analyzeProjectArchive(archive, validation, {
      workspaceRuntimeProfile: workspace.runtimeProfile
    });
    const record = await this.requireRecord(workspaceId);
    await this.provider.uploadArchive(record.handle, archive);

    record.workspace.project = {
      uploadedAt: this.now().toISOString(),
      analysis,
      archive: {
        entryCount: validation.entryCount,
        totalCompressedBytes: validation.totalCompressedBytes,
        totalUncompressedBytes: validation.totalUncompressedBytes
      }
    };
    await this.persist(record.workspace);

    return {
      workspace: cloneWorkspace(record.workspace),
      validation
    };
  }

  public async verifyProject(workspaceId: string): Promise<ProjectVerificationResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.project === undefined) {
      throw new Error(`Workspace ${workspaceId} has no uploaded project`);
    }
    if (workspace.project.analysis.projectType === "NPM") {
      return this.verifyNpm(workspaceId);
    }
    if (workspace.project.analysis.projectType === "MAVEN") {
      return this.verifyMaven(workspaceId);
    }
    throw new Error(`Unsupported project type: ${workspace.project.analysis.projectType}`);
  }

  public async verifyNpm(workspaceId: string): Promise<ProjectVerificationResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for verification: ${workspace.status}`);
    }
    if (workspace.project === undefined) {
      throw new Error(`Workspace ${workspaceId} has no uploaded project`);
    }
    if (workspace.project.analysis.projectType !== "NPM") {
      throw new Error(
        `Workspace ${workspaceId} project is not npm: ${workspace.project.analysis.projectType}`
      );
    }

    const record = await this.requireRecord(workspaceId);
    return new NpmVerifier(this.provider).verify(record.handle);
  }


  public async verifyMaven(workspaceId: string): Promise<ProjectVerificationResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for verification: ${workspace.status}`);
    }
    if (workspace.project === undefined) {
      throw new Error(`Workspace ${workspaceId} has no uploaded project`);
    }
    if (workspace.project.analysis.projectType !== "MAVEN") {
      throw new Error(
        `Workspace ${workspaceId} project is not Maven: ${workspace.project.analysis.projectType}`
      );
    }

    const record = await this.requireRecord(workspaceId);
    const relativeRoot = workspace.project.analysis.projectRoots[0] ?? "";
    const projectRoot = relativeRoot.length === 0
      ? "/workspace/project"
      : `/workspace/project/${relativeRoot}`;
    return new MavenVerifier(this.provider, { projectRoot }).verify(record.handle);
  }

  public async startPrototype(workspaceId: string): Promise<PrototypeStartResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for prototype start: ${workspace.status}`);
    }
    if (workspace.project === undefined) {
      throw new Error(`Workspace ${workspaceId} has no uploaded project`);
    }
    if (workspace.project.analysis.projectType !== "NPM") {
      throw new Error(
        `Workspace ${workspaceId} project is not npm: ${workspace.project.analysis.projectType}`
      );
    }
    if (workspace.prototype?.status === "RUNNING") {
      throw new Error(`Workspace ${workspaceId} already has a running prototype`);
    }

    const record = await this.requireRecord(workspaceId);
    const relativeRoot = workspace.project.analysis.projectRoots[0] ?? "";
    const projectRoot = relativeRoot.length === 0
      ? "/workspace/project"
      : `/workspace/project/${relativeRoot}`;
    const result = await new PrototypeService(this.provider, { projectRoot }).start(record.handle);
    if (result.status === "RUNNING") {
      record.workspace.prototype = {
        status: "RUNNING",
        strategy: result.strategy,
        port: result.port,
        url: result.url,
        processId: result.processId,
        startedAt: this.now().toISOString()
      };
      await this.persist(record.workspace);
    }
    return result;
  }

  public async screenshotPrototype(
    workspaceId: string,
    viewport?: ScreenshotViewport
  ): Promise<PrototypeScreenshotResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for screenshot: ${workspace.status}`);
    }
    if (workspace.prototype?.status !== "RUNNING") {
      throw new Error(`Workspace ${workspaceId} has no running prototype`);
    }

    const record = await this.requireRecord(workspaceId);
    const relativeRoot = workspace.project?.analysis.projectRoots[0] ?? "";
    const projectRoot = relativeRoot.length === 0
      ? "/workspace/project"
      : `/workspace/project/${relativeRoot}`;
    return new ScreenshotService(this.provider, {
      projectRoot,
      maxScreenshotBytes: this.securityPolicy.maxScreenshotBytes
    }).capture(record.handle, {
      url: workspace.prototype.url,
      ...(viewport !== undefined ? { viewport } : {})
    });
  }

  public async destroy(workspaceId: string): Promise<Workspace> {
    const record = await this.requireRecord(workspaceId);
    if (record.workspace.status === "DESTROYED" || record.workspace.status === "EXPIRED") {
      return cloneWorkspace(record.workspace);
    }

    let terminationError: unknown;
    try {
      await this.provider.terminate(record.handle);
    } catch (error) {
      terminationError = error;
    } finally {
      record.workspace.status = "DESTROYED";
      record.workspace.destroyedAt = this.now().toISOString();
      await this.persist(record.workspace);
    }
    if (terminationError !== undefined) throw terminationError;
    return cloneWorkspace(record.workspace);
  }

  private async expire(workspaceId: string): Promise<void> {
    const record = this.records.get(workspaceId);
    if (
      record === undefined ||
      (record.workspace.status !== "CREATING" && record.workspace.status !== "READY")
    ) {
      return;
    }

    try {
      await this.provider.terminate(record.handle);
    } finally {
      record.workspace.status = "EXPIRED";
      record.workspace.destroyedAt = this.now().toISOString();
      await this.persist(record.workspace);
    }
  }

  public async cleanupExpired(limit = 100): Promise<number> {
    if (!this.repository) return 0;
    const expired = await this.repository.listExpiredActive(this.now().toISOString(), limit);
    let count = 0;
    for (const workspace of expired) {
      if (workspace.userId !== this.userId) continue;
      if (!workspace.providerId || !workspace.providerWorkspaceId) {
        await this.repository.upsert({
          ...workspace,
          status: "EXPIRED",
          destroyedAt: this.now().toISOString()
        });
        count += 1;
        continue;
      }
      const record = this.hydrate(workspace);
      this.records.set(workspace.id, record);
      await this.expire(workspace.id);
      count += 1;
    }
    return count;
  }

  private async requireRecord(workspaceId: string): Promise<WorkspaceRecord> {
    const cached = this.records.get(workspaceId);
    if (cached) return cached;

    const persisted = await this.repository?.findByIdForUser(workspaceId, this.userId);
    if (!persisted) throw new Error(`Workspace not found: ${workspaceId}`);
    const record = this.hydrate(persisted);
    this.records.set(workspaceId, record);
    return record;
  }

  private hydrate(workspace: PersistedWorkspace): WorkspaceRecord {
    if (!workspace.providerId || !workspace.providerWorkspaceId) {
      throw new Error(`Workspace ${workspace.id} has no allocated provider resource`);
    }
    const hydrated: Workspace = {
      ...workspace,
      providerId: workspace.providerId,
      providerWorkspaceId: workspace.providerWorkspaceId
    };
    return {
      workspace: cloneWorkspace(hydrated),
      handle: {
        providerId: workspace.providerId,
        providerWorkspaceId: workspace.providerWorkspaceId
      }
    };
  }

  private async persist(workspace: Workspace): Promise<void> {
    await this.repository?.upsert(cloneWorkspace(workspace));
  }

  private async reserveWorkspace(workspace: PersistedWorkspace): Promise<boolean> {
    if (this.repository) {
      return this.repository.reserveWorkspace(
        workspace,
        this.securityPolicy.maxActiveWorkspacesPerUser
      );
    }

    const activeRecords = [...this.records.values()].filter(
      (record) =>
        record.workspace.status === "CREATING" || record.workspace.status === "READY"
    ).length;
    if (
      activeRecords + this.localReservations.size >=
      this.securityPolicy.maxActiveWorkspacesPerUser
    ) {
      return false;
    }

    this.localReservations.add(workspace.id);
    return true;
  }

  private async releaseReservation(workspaceId: string): Promise<void> {
    this.localReservations.delete(workspaceId);
    await this.repository?.deleteReservation(workspaceId, this.userId);
  }

  private isExpired(workspace: Workspace): boolean {
    return this.now().getTime() >= Date.parse(workspace.expiresAt);
  }

  private validateLifetime(lifetimeMinutes: number): void {
    if (!Number.isFinite(lifetimeMinutes) || lifetimeMinutes <= 0) {
      throw new Error("Workspace lifetime must be greater than zero minutes");
    }
    if (lifetimeMinutes > this.maxLifetimeMinutes) {
      throw new Error(
        `Workspace lifetime may not exceed ${this.maxLifetimeMinutes} minutes`
      );
    }
  }
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    ...(workspace.project !== undefined
      ? {
          project: {
            ...workspace.project,
            analysis: {
              ...workspace.project.analysis,
              projectRoots: [...workspace.project.analysis.projectRoots],
              recommendedRuntime: { ...workspace.project.analysis.recommendedRuntime },
              warnings: workspace.project.analysis.warnings.map((warning) => ({ ...warning })),
              ...(workspace.project.analysis.java !== undefined
                ? { java: { ...workspace.project.analysis.java } }
                : {}),
              ...(workspace.project.analysis.node !== undefined
                ? { node: { ...workspace.project.analysis.node } }
                : {})
            },
            archive: { ...workspace.project.archive }
          }
        }
      : {}),
    ...(workspace.prototype !== undefined
      ? { prototype: { ...workspace.prototype } }
      : {})
  };
}
