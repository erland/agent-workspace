import { ModalClient, type Sandbox } from "modal";

import { modalClientParamsFromCredentials } from "./modal-credentials.js";
import type { ModalExecutionCredentials } from "../../execution/execution-account.js";
import { redactSensitiveText } from "../../security/redaction.js";

import type {
  Command,
  CreateWorkspaceOptions,
  ExecutionResult,
  SandboxProvider,
  WorkspaceHandle
} from "../../core/sandbox-provider.js";

interface ModalSandboxProviderOptions {
  tokenId?: string;
  tokenSecret?: string;
  credentials?: ModalExecutionCredentials;
  appName: string;
}

export class ModalSandboxProvider implements SandboxProvider {
  private readonly client: ModalClient;
  private readonly appName: string;

  public constructor(options: ModalSandboxProviderOptions) {
    if (options.credentials && (options.tokenId !== undefined || options.tokenSecret !== undefined)) {
      throw new Error("Provide either credentials or tokenId/tokenSecret, not both");
    }

    const clientParams = options.credentials
      ? modalClientParamsFromCredentials(options.credentials)
      : options.tokenId !== undefined && options.tokenSecret !== undefined
        ? { tokenId: options.tokenId, tokenSecret: options.tokenSecret }
        : undefined;

    this.client = new ModalClient(clientParams);
    this.appName = options.appName;
  }

  public async createWorkspace(
    options: CreateWorkspaceOptions
  ): Promise<WorkspaceHandle> {
    const app = await this.client.apps.fromName(this.appName, {
      createIfMissing: true
    });
    const image = this.client.images.fromRegistry(options.imageRef);

    const sandbox = await this.client.sandboxes.create(app, image, {
      command: ["sleep", "3600"],
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.cpu !== undefined ? { cpu: options.cpu } : {}),
      ...(options.cpuLimit !== undefined ? { cpuLimit: options.cpuLimit } : {}),
      ...(options.memoryMiB !== undefined
        ? { memoryMiB: options.memoryMiB }
        : {}),
      ...(options.encryptedPorts !== undefined
        ? { encryptedPorts: [...options.encryptedPorts] }
        : {}),
      ...(options.networkPolicy?.blockNetwork !== undefined
        ? { blockNetwork: options.networkPolicy.blockNetwork }
        : {}),
      ...(options.networkPolicy?.outboundDomainAllowlist !== undefined
        ? { outboundDomainAllowlist: [...options.networkPolicy.outboundDomainAllowlist] }
        : {}),
      ...(options.networkPolicy?.outboundCidrAllowlist !== undefined
        ? { outboundCidrAllowlist: [...options.networkPolicy.outboundCidrAllowlist] }
        : {})
    });

    return {
      providerId: "modal",
      providerWorkspaceId: sandbox.sandboxId
    };
  }

  public async uploadArchive(
    handle: WorkspaceHandle,
    archive: Uint8Array
  ): Promise<void> {
    const sandbox = await this.getSandbox(handle);
    const archivePath = "/tmp/agent-workspace-project.zip";
    await sandbox.filesystem.writeBytes(archive, archivePath);

    const extraction = await this.exec(handle, {
      argv: [
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "rm -rf /workspace/project",
          "mkdir -p /workspace/project",
          `unzip -q ${archivePath} -d /workspace/project`,
          `rm -f ${archivePath}`
        ].join(" && ")
      ],
      timeoutMs: 2 * 60 * 1000
    });

    if (extraction.exitCode !== 0) {
      throw new Error(
        `Provider archive extraction failed: ${redactSensitiveText(extraction.stderr || extraction.stdout)}`
      );
    }
  }

  public async exec(
    handle: WorkspaceHandle,
    command: Command
  ): Promise<ExecutionResult> {
    const sandbox = await this.getSandbox(handle);
    const process = await sandbox.exec([...command.argv], {
      ...(command.workdir !== undefined ? { workdir: command.workdir } : {}),
      ...(command.timeoutMs !== undefined
        ? { timeoutMs: command.timeoutMs }
        : {}),
      ...(command.env !== undefined ? { env: { ...command.env } } : {})
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.readText(),
      process.stderr.readText(),
      process.wait()
    ]);

    return { exitCode, stdout, stderr };
  }

  public async readFile(handle: WorkspaceHandle, path: string): Promise<Uint8Array> {
    const sandbox = await this.getSandbox(handle);
    return sandbox.filesystem.readBytes(path);
  }

  public async getTunnelUrl(handle: WorkspaceHandle, port: number): Promise<string> {
    const sandbox = await this.getSandbox(handle);
    const tunnels = await sandbox.tunnels();
    const tunnel = tunnels[port];
    if (!tunnel) throw new Error(`No encrypted tunnel available for port ${port}`);
    return tunnel.url;
  }

  public async terminate(handle: WorkspaceHandle): Promise<void> {
    const sandbox = await this.getSandbox(handle);
    await sandbox.terminate({ wait: true });
  }

  private async getSandbox(handle: WorkspaceHandle): Promise<Sandbox> {
    if (handle.providerId !== "modal") {
      throw new Error(`Unsupported provider handle: ${handle.providerId}`);
    }
    return this.client.sandboxes.fromId(handle.providerWorkspaceId);
  }
}
