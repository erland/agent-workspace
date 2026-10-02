import { randomUUID } from "node:crypto";
import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import { failureExcerpt, failureSummary } from "../verification/log-bounds.js";

export const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 }
} as const;

export type ViewportPreset = keyof typeof VIEWPORT_PRESETS;
export interface ViewportSize { width: number; height: number; }
export type ScreenshotViewport = ViewportPreset | ViewportSize;

export interface PrototypeScreenshotRequest {
  url: string;
  viewport?: ScreenshotViewport;
}

export interface PrototypeScreenshotSuccess {
  status: "PASSED";
  mimeType: "image/png";
  width: number;
  height: number;
  bytes: Uint8Array;
  artifactId: string;
  fileName: string;
  durationMs: number;
}

export interface PrototypeScreenshotFailure {
  status: "FAILED";
  failureSummary: string;
  logExcerpt: string;
  durationMs: number;
}

export type PrototypeScreenshotResult = PrototypeScreenshotSuccess | PrototypeScreenshotFailure;

export interface ScreenshotServiceOptions {
  projectRoot?: string;
  timeoutMs?: number;
  maxFailureExcerptChars?: number;
  maxScreenshotBytes?: number;
  nowMs?: () => number;
  artifactIdFactory?: () => string;
}

const DEFAULT_PROJECT_ROOT = "/workspace/project";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const SCREENSHOT_PATH_PREFIX = "/tmp/agent-workspace-screenshot-";
const PLAYWRIGHT_MODULE = "/opt/agent-workspace/browser-tools/node_modules/playwright";

export class ScreenshotService {
  private readonly projectRoot: string;
  private readonly timeoutMs: number;
  private readonly maxFailureExcerptChars: number | undefined;
  private readonly maxScreenshotBytes: number;
  private readonly nowMs: () => number;
  private readonly artifactIdFactory: () => string;

  public constructor(
    private readonly provider: SandboxProvider,
    options: ScreenshotServiceOptions = {}
  ) {
    this.projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxFailureExcerptChars = options.maxFailureExcerptChars;
    this.maxScreenshotBytes = options.maxScreenshotBytes ?? DEFAULT_MAX_SCREENSHOT_BYTES;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.artifactIdFactory = options.artifactIdFactory ?? randomUUID;
  }

  public async capture(
    handle: WorkspaceHandle,
    request: PrototypeScreenshotRequest
  ): Promise<PrototypeScreenshotResult> {
    const startedAt = this.nowMs();
    const viewport = resolveViewport(request.viewport);
    const artifactId = this.artifactIdFactory();
    const screenshotPath = screenshotArtifactPath(artifactId);
    const fileName = screenshotFileName(request.viewport, viewport, artifactId);
    const payload = Buffer.from(JSON.stringify({
      url: request.url,
      width: viewport.width,
      height: viewport.height,
      path: screenshotPath
    }), "utf8").toString("base64");

    const script = [
      `const { chromium } = require('${PLAYWRIGHT_MODULE}');`,
      "const spec=JSON.parse(Buffer.from(process.env.AGENT_WORKSPACE_SCREENSHOT_B64,'base64').toString('utf8'));",
      "(async()=>{ let browser; try {",
      "browser=await chromium.launch({headless:true});",
      "const page=await browser.newPage({viewport:{width:spec.width,height:spec.height}});",
      "await page.goto(spec.url,{waitUntil:'networkidle',timeout:45000});",
      "await page.screenshot({path:spec.path,type:'png',fullPage:false});",
      "} finally { if(browser) await browser.close(); } })().catch(err=>{console.error(err && err.stack ? err.stack : String(err)); process.exit(1);});"
    ].join("");

    const execution = await this.provider.exec(handle, {
      argv: ["node", "-e", script],
      env: { AGENT_WORKSPACE_SCREENSHOT_B64: payload },
      workdir: this.projectRoot,
      timeoutMs: this.timeoutMs
    });

    if (execution.exitCode !== 0) {
      return {
        status: "FAILED",
        failureSummary: failureSummary(execution.stdout, execution.stderr),
        logExcerpt: failureExcerpt(execution.stdout, execution.stderr, this.maxFailureExcerptChars),
        durationMs: Math.max(0, this.nowMs() - startedAt)
      };
    }

    try {
      const sizeResult = await this.provider.exec(handle, {
        argv: ["stat", "-c", "%s", screenshotPath],
        timeoutMs: 5_000
      });
      if (sizeResult.exitCode !== 0) {
        throw new Error("Could not determine screenshot output size");
      }
      const size = Number(sizeResult.stdout.trim());
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("Screenshot output size is invalid");
      }
      if (size > this.maxScreenshotBytes) {
        throw new Error(`Screenshot output exceeds maximum size of ${this.maxScreenshotBytes} bytes`);
      }

      const bytes = await this.provider.readFile(handle, screenshotPath);
      if (bytes.byteLength > this.maxScreenshotBytes) {
        throw new Error(`Screenshot output exceeds maximum size of ${this.maxScreenshotBytes} bytes`);
      }
      if (!isPngScreenshot(bytes)) {
        throw new Error("Screenshot output is not a PNG file");
      }
      return {
        status: "PASSED",
        mimeType: "image/png",
        width: viewport.width,
        height: viewport.height,
        bytes,
        artifactId,
        fileName,
        durationMs: Math.max(0, this.nowMs() - startedAt)
      };
    } catch (error) {
      const message = String(error);
      return {
        status: "FAILED",
        failureSummary: message,
        logExcerpt: message,
        durationMs: Math.max(0, this.nowMs() - startedAt)
      };
    }
  }
}

export function resolveViewport(viewport: ScreenshotViewport | undefined): ViewportSize {
  if (viewport === undefined) return { ...VIEWPORT_PRESETS.desktop };
  if (typeof viewport === "string") return { ...VIEWPORT_PRESETS[viewport] };
  const { width, height } = viewport;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error("Viewport width/height must be integers from 1 to 4096");
  }
  return { width, height };
}

export function screenshotArtifactPath(artifactId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(artifactId)) {
    throw new Error("Invalid screenshot artifact id");
  }
  return `${SCREENSHOT_PATH_PREFIX}${artifactId}.png`;
}

export function isPngScreenshot(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= sig.length && sig.every((value, index) => bytes[index] === value);
}

function screenshotFileName(
  requested: ScreenshotViewport | undefined,
  viewport: ViewportSize,
  artifactId: string
): string {
  const label = typeof requested === "string" ? requested : `${viewport.width}x${viewport.height}`;
  return `prototype-${label}-${artifactId}.png`;
}
