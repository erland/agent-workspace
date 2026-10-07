import { randomUUID } from "node:crypto";
import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from "../security/security-policy.js";

import {
  validateZipArchive,
  type ArchiveValidationLimits,
  type ArchiveValidationResult
} from "../archive/archive-validator.js";
import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import { RUNTIME_PROFILES } from "../core/runtime-profile.js";
import type { ArtifactRepository, WorkspaceRepository } from "../persistence/repositories.js";
import type { ArtifactRecord, PersistedWorkspace } from "../persistence/models.js";
import { ArtifactService } from "../artifact/artifact-service.js";
import { ProjectBuildService, type RequestedBuildOutput } from "../artifact/project-build-service.js";
import { NpmVerifier } from "../verification/npm-verifier.js";
import { MavenVerifier } from "../verification/maven-verifier.js";
import type { ProjectVerificationResult } from "../verification/verification-result.js";
import { analyzeProjectArchive, type ProjectAnalysis } from "../project/project-detector.js";
import {
  resolveRuntimeProfile,
  type RuntimeProfileId,
  type RuntimeRequest
} from "../core/runtime-profile.js";
import type { ObjectStore } from "../storage/object-store.js";
import { InMemoryObjectStore } from "../storage/in-memory-object-store.js";

export type WorkspaceStatus = "CREATING" | "READY" | "DESTROYED" | "EXPIRED";

export interface WorkspaceProject {
  uploadedAt: string;
  sourceStorageKey: string;
  analysis: ProjectAnalysis;
  archive: {
    entryCount: number;
    totalCompressedBytes: number;
    totalUncompressedBytes: number;
  };
}


export interface Workspace {
  id: string;
  userId: string;
  providerId?: string;
  providerWorkspaceId?: string;
  runtimeProfile: RuntimeProfileId;
  status: WorkspaceStatus;
  createdAt: string;
  expiresAt: string;
  destroyedAt?: string;
  project?: WorkspaceProject;
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
  objectStore?: ObjectStore;
  artifactRepository?: ArtifactRepository;
  artifactTtlMinutes?: number;
}

interface WorkspaceRecord {
  workspace: Workspace;
  handle?: WorkspaceHandle;
  expiryTimer?: { unref?: () => void };
}

const DEFAULT_LIFETIME_MINUTES = 60;
const MAX_LIFETIME_MINUTES = 60;
const EPHEMERAL_EXECUTION_TIMEOUT_MS = 10 * 60_000;

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
  private readonly objectStore: ObjectStore;
  private readonly artifactService: ArtifactService | undefined;

  public constructor(
    private readonly provider: SandboxProvider,
    options: WorkspaceServiceOptions = {}
  ) {
    this.defaultLifetimeMinutes = options.defaultLifetimeMinutes ?? DEFAULT_LIFETIME_MINUTES;
    this.maxLifetimeMinutes = Math.min(
      options.maxLifetimeMinutes ?? options.securityPolicy?.maxWorkspaceLifetimeMinutes ?? MAX_LIFETIME_MINUTES,
      MAX_LIFETIME_MINUTES
    );
    this.archiveLimits = options.archiveLimits ?? {};
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `ws_${randomUUID()}`);
    this.userId = options.userId ?? "dev-user";
    this.repository = options.repository;
    this.securityPolicy = options.securityPolicy ?? DEFAULT_SECURITY_POLICY;
    this.objectStore = options.objectStore ?? new InMemoryObjectStore();
    this.artifactService = options.artifactRepository
      ? new ArtifactService(this.userId, options.artifactRepository, this.objectStore, {
          ttlMinutes: options.artifactTtlMinutes ?? 60,
          maxArtifactBytes: this.securityPolicy.maxArtifactBytes,
          now: this.now
        })
      : undefined;
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

    try {
      const workspace: Workspace = {
        ...reservation,
        status: "READY"
      };
      await this.persist(workspace);
      this.localReservations.delete(workspaceId);
      this.records.set(workspaceId, { workspace });

      const expiryTimer = this.schedule?.(() => {
        void this.expire(workspaceId);
      }, lifetimeMinutes * 60_000);
      expiryTimer?.unref?.();
      const record = this.records.get(workspaceId);
      if (record && expiryTimer !== undefined) record.expiryTimer = expiryTimer;

      return cloneWorkspace(workspace);
    } catch (error) {
      await this.releaseReservation(workspaceId).catch(() => undefined);
      this.localReservations.delete(workspaceId);
      throw error;
    }
  }

  public async get(workspaceId: string): Promise<Workspace> {
    const record = await this.requireRecord(workspaceId);
    if (record.workspace.status === "READY" && this.isExpired(record.workspace)) {
      await this.expire(workspaceId);
    } else if (
      record.workspace.status === "READY" &&
      record.workspace.prototype?.status === "RUNNING" &&
      Date.parse(record.workspace.prototype.expiresAt) <= this.now().getTime()
    ) {
      await this.stopPrototype(workspaceId).catch(() => undefined);
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
    const sourceStorageKey = this.sourceStorageKey(workspaceId);
    await this.objectStore.put(sourceStorageKey, archive);

    record.workspace.project = {
      uploadedAt: this.now().toISOString(),
      sourceStorageKey,
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
    const workspace = await this.requireReadyProject(workspaceId, "verification");
    if (workspace.project!.analysis.projectType !== "NPM") {
      throw new Error(
        `Workspace ${workspaceId} project is not npm: ${workspace.project!.analysis.projectType}`
      );
    }

    return this.withEphemeralProject(workspace, async (handle) =>
      new NpmVerifier(this.provider, {
        projectRoot: resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots)
      }).verify(handle)
    );
  }

  public async verifyMaven(workspaceId: string): Promise<ProjectVerificationResult> {
    const workspace = await this.requireReadyProject(workspaceId, "verification");
    if (workspace.project!.analysis.projectType !== "MAVEN") {
      throw new Error(
        `Workspace ${workspaceId} project is not Maven: ${workspace.project!.analysis.projectType}`
      );
    }

    return this.withEphemeralProject(workspace, async (handle) =>
      new MavenVerifier(this.provider, {
        projectRoot: resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots)
      }).verify(handle)
    );
  }

  public async buildProject(
    workspaceId: string,
    outputs: readonly RequestedBuildOutput[] = []
  ): Promise<{ status: "PASSED"; projectType: "NPM" | "MAVEN"; artifacts: ArtifactRecord[] }> {
    const workspace = await this.requireReadyProject(workspaceId, "build");
    const projectType = workspace.project!.analysis.projectType;
    if (projectType !== "NPM" && projectType !== "MAVEN") {
      throw new Error(`Unsupported build project type: ${projectType}`);
    }
    const artifactService = this.requireArtifactService();
    return this.withEphemeralProject(workspace, async (handle) => {
      const result = await new ProjectBuildService(
        this.provider,
        resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots),
        this.securityPolicy.maxArtifactBytes
      ).build(handle, projectType, outputs);
      const artifacts: ArtifactRecord[] = [];
      for (const output of result.outputs) {
        artifacts.push(await artifactService.publish({
          workspaceId,
          name: output.name,
          kind: output.kind,
          filename: output.filename,
          mediaType: output.mediaType,
          bytes: output.bytes
        }));
      }
      return { status: "PASSED", projectType, artifacts };
    });
  }

  public async getArtifact(artifactId: string): Promise<ArtifactRecord> {
    return this.requireArtifactService().get(artifactId);
  }

  public async readArtifact(artifactId: string): Promise<{ artifact: ArtifactRecord; bytes: Uint8Array }> {
    return this.requireArtifactService().read(artifactId);
  }

  public async listArtifacts(workspaceId: string): Promise<ArtifactRecord[]> {
    await this.get(workspaceId);
    return this.requireArtifactService().list(workspaceId);
  }

  public async destroy(workspaceId: string): Promise<Workspace> {
    const record = await this.requireRecord(workspaceId);
    if (record.workspace.status === "DESTROYED" || record.workspace.status === "EXPIRED") {
      return cloneWorkspace(record.workspace);
    }

    let terminationError: unknown;
    if (record.handle) {
      try {
        await this.provider.terminate(record.handle);
      } catch (error) {
        terminationError = error;
      }
    }
    delete record.handle;
    delete record.workspace.providerId;
    delete record.workspace.providerWorkspaceId;
    record.workspace.status = "DESTROYED";
    record.workspace.destroyedAt = this.now().toISOString();
    await this.persist(record.workspace);
    await this.objectStore.deletePrefix(this.workspaceStoragePrefix(workspaceId)).catch(() => undefined);

    if (terminationError !== undefined) throw terminationError;
    return cloneWorkspace(record.workspace);
  }

  private async expire(workspaceId: string): Promise<void> {
    const record = this.records.get(workspaceId) ?? await this.requireRecord(workspaceId);
    if (
      record.workspace.status !== "CREATING" &&
      record.workspace.status !== "READY"
    ) {
      return;
    }

    if (record.handle) {
      await this.provider.terminate(record.handle).catch(() => undefined);
    }
    delete record.handle;
    delete record.workspace.providerId;
    delete record.workspace.providerWorkspaceId;
    record.workspace.status = "EXPIRED";
    record.workspace.destroyedAt = this.now().toISOString();
    await this.persist(record.workspace);
    await this.objectStore.deletePrefix(this.workspaceStoragePrefix(workspaceId)).catch(() => undefined);
  }

  public async cleanupExpired(limit = 100): Promise<number> {
    if (!this.repository) return 0;
    const expired = await this.repository.listExpiredActive(this.now().toISOString(), limit);
    let count = 0;
    for (const workspace of expired) {
      if (workspace.userId !== this.userId) continue;
      const record = this.hydrate(workspace);
      this.records.set(workspace.id, record);
      await this.expire(workspace.id);
      count += 1;
    }
    return count;
  }

  private requireArtifactService(): ArtifactService {
    if (!this.artifactService) throw new Error("Artifact storage is not configured");
    return this.artifactService;
  }

  private async requireReadyProject(workspaceId: string, action: string): Promise<Workspace> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for ${action}: ${workspace.status}`);
    }
    if (workspace.project === undefined) {
      throw new Error(`Workspace ${workspaceId} has no uploaded project`);
    }
    return workspace;
  }

  private async withEphemeralProject<T>(
    workspace: Workspace,
    operation: (handle: WorkspaceHandle) => Promise<T>
  ): Promise<T> {
    const handle = await this.createExecution(workspace);
    try {
      await this.uploadStoredSource(workspace, handle);
      return await operation(handle);
    } finally {
      await this.provider.terminate(handle).catch(() => undefined);
    }
  }

  private async createExecution(workspace: Workspace): Promise<WorkspaceHandle> {
    const profile = RUNTIME_PROFILES[workspace.runtimeProfile];
    const remainingMs = Math.max(1, Date.parse(workspace.expiresAt) - this.now().getTime());
    const timeoutMs = Math.min(EPHEMERAL_EXECUTION_TIMEOUT_MS, remainingMs);
    return this.provider.createWorkspace({
      imageRef: profile.imageRef,
      timeoutMs,
      cpu: this.securityPolicy.workspaceCpu,
      cpuLimit: this.securityPolicy.workspaceCpuLimit,
      memoryMiB: this.securityPolicy.workspaceMemoryMiB,
      networkPolicy: this.securityPolicy.networkPolicy
    });
  }

  private async uploadStoredSource(workspace: Workspace, handle: WorkspaceHandle): Promise<void> {
    const key = workspace.project?.sourceStorageKey;
    if (!key) throw new Error(`Workspace ${workspace.id} has no stored source archive`);
    const archive = await this.objectStore.get(key);
    await this.provider.uploadArchive(handle, archive);
  }

  private requireActiveHandle(record: WorkspaceRecord): WorkspaceHandle {
    if (record.handle) return record.handle;
    const { providerId, providerWorkspaceId } = record.workspace;
    if (!providerId || !providerWorkspaceId) {
      throw new Error(`Workspace ${record.workspace.id} has no active execution`);
    }
    const handle = { providerId, providerWorkspaceId };
    record.handle = handle;
    return handle;
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
    const hydrated: Workspace = { ...workspace };
    const handle =
      workspace.providerId && workspace.providerWorkspaceId
        ? {
            providerId: workspace.providerId,
            providerWorkspaceId: workspace.providerWorkspaceId
          }
        : undefined;
    return {
      workspace: cloneWorkspace(hydrated),
      ...(handle ? { handle } : {})
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

  private workspaceStoragePrefix(workspaceId: string): string {
    return `workspaces/${this.userId}/${workspaceId}/`;
  }

  private sourceStorageKey(workspaceId: string): string {
    return `${this.workspaceStoragePrefix(workspaceId)}source.zip`;
  }

  private screenshotStorageKey(workspaceId: string, artifactId: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(artifactId)) throw new Error("Invalid screenshot artifact id");
    return `${this.workspaceStoragePrefix(workspaceId)}screenshots/${artifactId}.png`;
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
  };
}

function resolveWorkspaceProjectRoot(projectRoots: readonly string[]): string {
  const relativeRoot = projectRoots[0] ?? "";
  return relativeRoot.length === 0
    ? "/workspace/project"
    : `/workspace/project/${relativeRoot}`;
}
