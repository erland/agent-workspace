export interface NetworkPolicy {
  blockNetwork?: boolean;
  outboundDomainAllowlist?: readonly string[];
  outboundCidrAllowlist?: readonly string[];
}

export interface CreateWorkspaceOptions {
  imageRef: string;
  timeoutMs?: number;
  cpu?: number;
  cpuLimit?: number;
  memoryMiB?: number;
  networkPolicy?: NetworkPolicy;
}

export interface WorkspaceHandle {
  providerId: string;
  providerWorkspaceId: string;
}

export interface Command {
  argv: readonly string[];
  workdir?: string;
  timeoutMs?: number;
  env?: Readonly<Record<string, string>>;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxProvider {
  createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceHandle>;
  uploadArchive(handle: WorkspaceHandle, archive: Uint8Array): Promise<void>;
  exec(handle: WorkspaceHandle, command: Command): Promise<ExecutionResult>;
  readFile(handle: WorkspaceHandle, path: string): Promise<Uint8Array>;
  terminate(handle: WorkspaceHandle): Promise<void>;
}
