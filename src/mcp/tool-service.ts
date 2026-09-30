import { getCapabilities } from "../core/capabilities.js";
import type { ScreenshotViewport } from "../prototype/screenshot-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import { normalizeToolError } from "./errors.js";
import type { ProfileProvider } from "./profile.js";

export interface ToolSuccess<T> { ok: true; result: T; }
export interface ToolFailure { ok: false; error: ReturnType<typeof normalizeToolError>["error"]; }
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface AgentWorkspaceTools {
  getCapabilities(): Promise<ToolResult<unknown>>;
  getProfile(): Promise<ToolResult<unknown>>;
  createWorkspace(input: { java?: "17"|"21"|"25"; node?: "20"|"22"; lifetimeMinutes?: number }): Promise<ToolResult<unknown>>;
  uploadZip(input: { workspaceId: string; archiveBase64: string; filename?: string }): Promise<ToolResult<unknown>>;
  verifyProject(input: { workspaceId: string }): Promise<ToolResult<unknown>>;
  startPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>>;
  screenshotPrototype(input: { workspaceId: string; viewport?: ScreenshotViewport }): Promise<ToolResult<unknown>>;
  destroyWorkspace(input: { workspaceId: string }): Promise<ToolResult<unknown>>;
}

export class AgentWorkspaceToolService implements AgentWorkspaceTools {
  public constructor(
    private readonly workspaces: WorkspaceService,
    private readonly profiles: ProfileProvider
  ) {}

  public async getCapabilities(): Promise<ToolResult<ReturnType<typeof getCapabilities>>> {
    return { ok: true, result: getCapabilities() };
  }

  public async getProfile(): Promise<ToolResult<Awaited<ReturnType<ProfileProvider["getProfile"]>>>> {
    try { return { ok: true, result: await this.profiles.getProfile() }; }
    catch (error) { return this.failure(error); }
  }

  public async createWorkspace(input: { java?: "17"|"21"|"25"; node?: "20"|"22"; lifetimeMinutes?: number }): Promise<ToolResult<unknown>> {
    try {
      const runtime = input.java !== undefined || input.node !== undefined
        ? { ...(input.java ? { java: input.java } : {}), ...(input.node ? { node: input.node } : {}) }
        : undefined;
      return { ok: true, result: await this.workspaces.create({ ...(runtime ? { runtime } : {}), ...(input.lifetimeMinutes ? { lifetimeMinutes: input.lifetimeMinutes } : {}) }) };
    } catch (error) { return this.failure(error); }
  }

  public async uploadZip(input: { workspaceId: string; archiveBase64: string; filename?: string }): Promise<ToolResult<unknown>> {
    try {
      const archive = decodeBase64(input.archiveBase64);
      return { ok: true, result: await this.workspaces.uploadZip(input.workspaceId, archive) };
    } catch (error) { return this.failure(error); }
  }

  public async verifyProject(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    try { return { ok: true, result: await this.workspaces.verifyProject(input.workspaceId) }; }
    catch (error) { return this.failure(error); }
  }

  public async startPrototype(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    try { return { ok: true, result: await this.workspaces.startPrototype(input.workspaceId) }; }
    catch (error) { return this.failure(error); }
  }

  public async screenshotPrototype(input: { workspaceId: string; viewport?: ScreenshotViewport }): Promise<ToolResult<unknown>> {
    try {
      const result = await this.workspaces.screenshotPrototype(input.workspaceId, input.viewport);
      return { ok: true, result };
    } catch (error) { return this.failure(error); }
  }

  public async destroyWorkspace(input: { workspaceId: string }): Promise<ToolResult<unknown>> {
    try { return { ok: true, result: await this.workspaces.destroy(input.workspaceId) }; }
    catch (error) { return this.failure(error); }
  }

  private failure(error: unknown): ToolFailure {
    return { ok: false, ...normalizeToolError(error) };
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("archiveBase64 must be valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new Error("archiveBase64 decoded to an empty archive");
  return bytes;
}
