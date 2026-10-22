export interface CaptureFailure { path: string; reason: "NOT_FOUND" | "EMPTY" | "TOO_LARGE" | "READ_FAILED"; }
export interface ExecutionDiagnostics {
  sandboxCreatedAt: string;
  sandboxTerminatedAt: string;
  artifactsPublishedAt: string;
  terminationConfirmed: true;
}
import { InMemoryArtifactRepository } from "../persistence/in-memory.js";
import { readTextFile } from "../artifact/file-reader.js";
import { timedOperation } from "../diagnostics/operation-timing.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logSynchronousTiming } from "../diagnostics/operation-timing.js";
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
    this.artifactService = new ArtifactService(this.userId, options.artifactRepository ?? new InMemoryArtifactRepository(), this.objectStore, {
          ttlMinutes: options.artifactTtlMinutes ?? 60,
          maxArtifactBytes: this.securityPolicy.maxArtifactBytes,
          now: this.now
        });
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
    }
    return cloneWorkspace(record.workspace);
  }

  public async uploadZip(workspaceId: string, archive: Uint8Array): Promise<UploadZipResult> {
    const workspace = await this.get(workspaceId);
    if (workspace.status !== "READY") {
      throw new Error(`Workspace ${workspaceId} is not ready for upload: ${workspace.status}`);
    }

    const validationStart = performance.now();
    const validation = validateZipArchive(archive, this.archiveLimits);
    logSynchronousTiming("zip_validation", validationStart);
    const analysisStart = performance.now();
    const analysis = analyzeProjectArchive(archive, validation, {
      workspaceRuntimeProfile: workspace.runtimeProfile
    });
    logSynchronousTiming("project_analysis", analysisStart);
    const record = await this.requireRecord(workspaceId);
    const sourceStorageKey = this.sourceStorageKey(workspaceId);
    await timedOperation("zip_storage", () => this.objectStore.put(sourceStorageKey, archive));

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

  public async verifyProject(workspaceId: string, captureFiles: readonly string[] = []): Promise<ProjectVerificationResult & { logArtifact?: ArtifactRecord; artifacts?: ArtifactRecord[]; missingCaptureFiles: CaptureFailure[]; execution: ExecutionDiagnostics }> {
    const workspace = await this.requireReadyProject(workspaceId, "verification");
    const kind = workspace.project!.analysis.projectType;
    if (kind !== "NPM" && kind !== "MAVEN") throw new Error(`Unsupported project type: ${kind}`);
    const log: string[] = [];
    const capture = normalizeCaptureFiles(captureFiles, kind);
    const lifecycle: Partial<ExecutionDiagnostics> = {};
    const outcome = await this.withEphemeralProject(workspace, async (handle) => {
      const recorder = this.recordingProvider(log);
      let result: ProjectVerificationResult;
      try {
        result = kind === "NPM"
          ? await new NpmVerifier(recorder, { projectRoot: resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots) }).verify(handle)
          : await new MavenVerifier(recorder, { projectRoot: resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots) }).verify(handle);
      } catch (error) {
        result = { status: "FAILED", projectType: kind, durationMs: 0, steps: [], failureSummary: String(error) };
        log.push(`Verification error: ${String(error)}`);
      }
      const files = await this.captureProjectFiles(handle, workspace, capture, log);
      return { result, files };
    }, lifecycle);
    const artifactService = this.requireArtifactService();
    const artifacts = await this.publishCapturedFiles(workspaceId, outcome.files.files);
    const logArtifact = await this.publishExecutionLog(artifactService, workspaceId, "verify", log);
    lifecycle.artifactsPublishedAt = this.now().toISOString();
    return { ...outcome.result, logArtifact, artifacts, missingCaptureFiles: outcome.files.missing.filter(x => captureFiles.includes(x.path)), execution: lifecycle as ExecutionDiagnostics };
  }

  public async verifyNpm(workspaceId: string): Promise<ProjectVerificationResult> {
    return this.verifyProject(workspaceId);
  }

  public async verifyMaven(workspaceId: string): Promise<ProjectVerificationResult> {
    return this.verifyProject(workspaceId);
  }

  public async buildProject(
    workspaceId: string,
    outputs: readonly RequestedBuildOutput[] = [],
    captureFiles: readonly string[] = []
  ): Promise<{ status: "PASSED" | "FAILED"; projectType: "NPM" | "MAVEN"; artifacts: ArtifactRecord[]; logArtifact: ArtifactRecord; failureSummary?: string; missingCaptureFiles: CaptureFailure[]; execution: ExecutionDiagnostics }> {
    const workspace = await this.requireReadyProject(workspaceId, "build");
    const projectType = workspace.project!.analysis.projectType;
    if (projectType !== "NPM" && projectType !== "MAVEN") throw new Error(`Unsupported build project type: ${projectType}`);
    const log: string[] = [];
    const capture = normalizeCaptureFiles(captureFiles, projectType);
    const lifecycle: Partial<ExecutionDiagnostics> = {};
    const outcome = await this.withEphemeralProject(workspace, async (handle) => {
      const recorder = this.recordingProvider(log);
      let result: Awaited<ReturnType<ProjectBuildService["build"]>> | undefined;
      let failureSummary: string | undefined;
      try {
        result = await new ProjectBuildService(recorder,
          resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots),
          this.securityPolicy.maxArtifactBytes).build(handle, projectType, outputs);
      } catch (error) {
        failureSummary = String(error);
        log.push(`Build error: ${failureSummary}`);
      }
      const files = await this.captureProjectFiles(handle, workspace, capture, log);
      return { result, files, failureSummary };
    }, lifecycle);
    const artifactService = this.requireArtifactService();
    const artifacts: ArtifactRecord[] = [];
    for (const output of outcome.result?.outputs ?? []) {
      artifacts.push(await artifactService.publish({
        workspaceId, name: output.name, kind: output.kind,
        filename: output.filename, mediaType: output.mediaType, bytes: output.bytes
      }));
    }
    artifacts.push(...await this.publishCapturedFiles(workspaceId, outcome.files.files));
    const logArtifact = await this.publishExecutionLog(artifactService, workspaceId, "build", log);
    lifecycle.artifactsPublishedAt = this.now().toISOString();
    return {
      missingCaptureFiles: outcome.files.missing.filter(x => captureFiles.includes(x.path)),
      execution: lifecycle as ExecutionDiagnostics,
      status: outcome.result ? "PASSED" : "FAILED", projectType, artifacts, logArtifact,
      ...(outcome.failureSummary ? { failureSummary: outcome.failureSummary } : {})
    };
  }

  private recordingProvider(log: string[]): SandboxProvider {
    const underlying = this.provider;
    return {
      createWorkspace: (options) => underlying.createWorkspace(options),
      uploadArchive: (handle, archive) => underlying.uploadArchive(handle, archive),
      readFile: (handle, path) => underlying.readFile(handle, path),
      terminate: (handle) => underlying.terminate(handle),
      exec: async (handle, command) => {
        const started = performance.now();
        try {
          const result = await underlying.exec(handle, command);
          log.push(JSON.stringify({
            argv: command.argv, exitCode: result.exitCode, durationMs: Math.round(performance.now() - started),
            stdout: redactLog(result.stdout), stderr: redactLog(result.stderr)
          }));
          return result;
        } catch (error) {
          log.push(JSON.stringify({ argv: command.argv, error: redactLog(String(error)) }));
          throw error;
        }
      }
    };
  }

  private async captureProjectFiles(
    handle: WorkspaceHandle, workspace: Workspace, paths: readonly string[], log: string[]
  ): Promise<{ files: Array<{ path: string; bytes: Uint8Array }>; missing: CaptureFailure[] }> {
    const root = resolveWorkspaceProjectRoot(workspace.project!.analysis.projectRoots);
    const captured: Array<{ path: string; bytes: Uint8Array }> = [];
    const missing: CaptureFailure[] = [];
    for (const path of paths) {
      const full = `${root}/${path}`;
      try {
        const check = await this.provider.exec(handle, {
          argv: ["bash", "-lc", 'set -e; root=$(realpath -e -- "$1"); file=$(realpath -e -- "$2"); case "$file" in "$root"/*) ;; *) exit 3;; esac; test -f "$file"; stat -c %s "$file"', "_", root, full],
          timeoutMs: 30_000
        });
        if (check.exitCode !== 0) { log.push(`Capture unavailable: ${path}`); missing.push({path, reason: "NOT_FOUND"}); continue; }
        const size = Number(check.stdout.trim());
        if (!Number.isSafeInteger(size) || size < 0 || size > 5 * 1024 * 1024) {
          log.push(`Capture over size limit: ${path}`); missing.push({path, reason: "TOO_LARGE"}); continue;
        }
        const bytes = await this.provider.readFile(handle, full);
        if (bytes.length === 0) { log.push(`Capture empty: ${path}`); missing.push({path, reason: "EMPTY"}); continue; }
        if (bytes.length > 5 * 1024 * 1024) { log.push(`Capture over size limit: ${path}`); continue; }
        captured.push({ path, bytes });
      } catch (error) { log.push(`Capture failed for ${path}: ${redactLog(String(error))}`); missing.push({path, reason: "READ_FAILED"}); }
    }
    return { files: captured, missing };
  }

  private async publishCapturedFiles(workspaceId: string, files: readonly { path: string; bytes: Uint8Array }[]): Promise<ArtifactRecord[]> {
    const service = this.requireArtifactService();
    const published: ArtifactRecord[] = [];
    for (const file of files) {
      published.push(await service.publish({
        workspaceId, name: file.path, kind: "captured-file", filename: file.path.split("/").at(-1)!,
        mediaType: "text/plain", bytes: file.bytes
      }));
    }
    return published;
  }

  private async publishExecutionLog(service: ArtifactService, workspaceId: string, operation: string, entries: readonly string[]): Promise<ArtifactRecord> {
    const bytes = Buffer.from(entries.join("\n").slice(0, 1024 * 1024) || "(no command output)", "utf8");
    return service.publish({
      workspaceId, name: `${operation} log`, kind: "execution-log",
      filename: `${operation}.log`, mediaType: "text/plain", bytes
    });
  }

  public async fileRead(input: { workspaceId?: string | undefined; artifactId?: string | undefined; path?: string | undefined; offset?: number | undefined; limit?: number | undefined }) {
    if ((input.workspaceId === undefined) === (input.artifactId === undefined)) {
      throw new Error("Specify exactly one of workspaceId or artifactId");
    }
    if (input.workspaceId) {
      if (!input.path) throw new Error("path is required to read a workspace source file");
      const workspace = await this.requireReadyProject(input.workspaceId, "file read");
      const archive = await this.objectStore.get(workspace.project!.sourceStorageKey);
      const root = workspace.project!.analysis.projectRoots[0];
      const path = root ? `${root}/${input.path}` : input.path;
      return readTextFile(archive, "source.zip", path, input.offset, input.limit);
    }
    const { artifact, bytes } = await this.readArtifact(input.artifactId!);
    return readTextFile(bytes, artifact.filename, input.path, input.offset, input.limit);
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

    record.workspace.status = "DESTROYED";
    record.workspace.destroyedAt = this.now().toISOString();
    await this.persist(record.workspace);
    await this.objectStore.deletePrefix(this.workspaceStoragePrefix(workspaceId)).catch(() => undefined);

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
    operation: (handle: WorkspaceHandle) => Promise<T>,
    lifecycle?: Partial<ExecutionDiagnostics>
  ): Promise<T> {
    const handle = await timedOperation("sandbox_create", () => this.createExecution(workspace));
    if (lifecycle) lifecycle.sandboxCreatedAt = this.now().toISOString();
    try {
      await timedOperation("sandbox_upload_archive", () => this.uploadStoredSource(workspace, handle));
      return await timedOperation("sandbox_project_execution", () => operation(handle));
    } finally {
      // Always attempt termination, and surface failures instead of silently
      // reporting a successful operation when Modal cleanup may have failed.
      await timedOperation("sandbox_terminate", () => this.terminateExecution(handle));
      if (lifecycle) {
        lifecycle.sandboxTerminatedAt = this.now().toISOString();
        lifecycle.terminationConfirmed = true;
      }
    }
  }

  private async terminateExecution(handle: WorkspaceHandle): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.provider.terminate(handle);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Sandbox termination failed after 3 attempts (provider=${handle.providerId}, sandbox=${handle.providerWorkspaceId})`,
      { cause: lastError }
    );
  }

  private async createExecution(workspace: Workspace): Promise<WorkspaceHandle> {
    const profile = RUNTIME_PROFILES[workspace.runtimeProfile];
    const remainingMs = Date.parse(workspace.expiresAt) - this.now().getTime();
    const timeoutMs = executionTimeoutMs(remainingMs);
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
    const archive = await timedOperation("zip_storage_read", () => this.objectStore.get(key));
    await this.provider.uploadArchive(handle, archive);
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
    return { workspace: cloneWorkspace(workspace) };
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

/** Modal timeout is limited to whole seconds and must not extend past expiry. */
export function executionTimeoutMs(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs < 1000) {
    throw new Error("Workspace has less than one second remaining; create a new workspace");
  }
  return Math.floor(Math.min(remainingMs, EPHEMERAL_EXECUTION_TIMEOUT_MS) / 1000) * 1000;
}

function normalizeCaptureFiles(paths: readonly string[], kind: "NPM" | "MAVEN"): string[] {
  if (paths.length > 12) throw new Error("captureFiles exceeds 12 entries");
  const result = new Set<string>(kind === "NPM" ? ["package-lock.json"] : []);
  for (const path of paths) {
    if (!path || path.length > 512 || path.startsWith("/") || path.includes("\\\\") ||
        path.split("/").some((segment) => segment === ".." || segment === "" || segment === ".")) {
      throw new Error(`Invalid captureFiles path: ${path}`);
    }
    result.add(path);
  }
  return [...result];
}

function redactLog(value: string): string {
  return value.slice(0, 128 * 1024).replace(/(token|password|secret|authorization)(["'=:\\s]+)[^\\s"',]+/gi, "$1$2[REDACTED]");
}
