import type {
  Command,
  SandboxProvider,
  WorkspaceHandle
} from "../core/sandbox-provider.js";
import { boundLog, failureExcerpt, failureSummary } from "../verification/log-bounds.js";

export type PrototypeStartStrategy = "dev" | "start" | "preview";
export type PrototypeFailureStep = "inspect" | "install" | "build" | "start" | "readiness";

export interface PrototypeRunningResult {
  status: "RUNNING";
  strategy: PrototypeStartStrategy;
  port: number;
  url: string;
  processId: number;
  durationMs: number;
}

export interface PrototypeFailedResult {
  status: "FAILED";
  failedStep: PrototypeFailureStep;
  exitCode?: number;
  failureSummary: string;
  logExcerpt: string;
  durationMs: number;
}

export type PrototypeStartResult = PrototypeRunningResult | PrototypeFailedResult;

export interface PrototypeServiceOptions {
  projectRoot?: string;
  port?: number;
  installTimeoutMs?: number;
  buildTimeoutMs?: number;
  readinessTimeoutMs?: number;
  maxStepLogChars?: number;
  maxFailureExcerptChars?: number;
  nowMs?: () => number;
}

interface PackageInfo {
  hasPackageLock: boolean;
  scripts: Readonly<Record<string, string>>;
}

interface StartCommand {
  strategy: PrototypeStartStrategy;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
}

const DEFAULT_PROJECT_ROOT = "/workspace/project";
const DEFAULT_PORT = 4173;
const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_BUILD_TIMEOUT_MS = 3 * 60_000;
const DEFAULT_READINESS_TIMEOUT_MS = 45_000;
const PID_FILE = "/tmp/agent-workspace-prototype.pid";
const LOG_FILE = "/tmp/agent-workspace-prototype.log";

export class PrototypeService {
  private readonly projectRoot: string;
  private readonly port: number;
  private readonly installTimeoutMs: number;
  private readonly buildTimeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly maxStepLogChars: number | undefined;
  private readonly maxFailureExcerptChars: number | undefined;
  private readonly nowMs: () => number;

  public constructor(
    private readonly provider: SandboxProvider,
    options: PrototypeServiceOptions = {}
  ) {
    this.projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
    this.port = options.port ?? DEFAULT_PORT;
    this.installTimeoutMs = options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
    this.buildTimeoutMs = options.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.maxStepLogChars = options.maxStepLogChars;
    this.maxFailureExcerptChars = options.maxFailureExcerptChars;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  public async start(handle: WorkspaceHandle): Promise<PrototypeStartResult> {
    const startedAt = this.nowMs();

    let packageInfo: PackageInfo;
    try {
      packageInfo = await this.inspectPackage(handle);
    } catch (error) {
      return this.failure(startedAt, "inspect", undefined, String(error), String(error));
    }

    const install = await this.provider.exec(handle, {
      argv: packageInfo.hasPackageLock
        ? ["npm", "ci", "--no-audit", "--no-fund"]
        : ["npm", "install", "--no-audit", "--no-fund"],
      workdir: this.projectRoot,
      timeoutMs: this.installTimeoutMs
    });
    if (install.exitCode !== 0) {
      return this.failure(
        startedAt,
        "install",
        install.exitCode,
        install.stdout,
        install.stderr
      );
    }

    const startCommand = this.selectStartCommand(packageInfo.scripts);
    if (startCommand === undefined) {
      return this.failure(
        startedAt,
        "start",
        undefined,
        "",
        "No supported prototype start script found. Expected one of: dev, start, preview."
      );
    }

    if (startCommand.strategy === "preview" && packageInfo.scripts.build !== undefined) {
      const build = await this.provider.exec(handle, {
        argv: ["npm", "run", "build"],
        workdir: this.projectRoot,
        timeoutMs: this.buildTimeoutMs
      });
      if (build.exitCode !== 0) {
        return this.failure(startedAt, "build", build.exitCode, build.stdout, build.stderr);
      }
    }

    await this.cleanupProcess(handle);

    const launch = await this.launchInBackground(handle, startCommand);
    if (launch.exitCode !== 0) {
      return this.failure(startedAt, "start", launch.exitCode, launch.stdout, launch.stderr);
    }

    const processId = Number.parseInt(launch.stdout.trim(), 10);
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      await this.cleanupProcess(handle);
      return this.failure(
        startedAt,
        "start",
        launch.exitCode,
        launch.stdout,
        `Prototype process did not return a valid PID: ${launch.stderr}`
      );
    }

    const readiness = await this.provider.exec(handle, this.readinessCommand());
    if (readiness.exitCode !== 0) {
      await this.cleanupProcess(handle);
      return this.failure(
        startedAt,
        "readiness",
        readiness.exitCode,
        readiness.stdout,
        readiness.stderr
      );
    }

    return {
      status: "RUNNING",
      strategy: startCommand.strategy,
      port: this.port,
      url: `http://127.0.0.1:${this.port}`,
      processId,
      durationMs: Math.max(0, this.nowMs() - startedAt)
    };
  }

  public async stop(handle: WorkspaceHandle): Promise<void> {
    await this.cleanupProcess(handle);
  }

  private async inspectPackage(handle: WorkspaceHandle): Promise<PackageInfo> {
    const result = await this.provider.exec(handle, {
      argv: [
        "node",
        "-e",
        [
          "const fs=require('fs');",
          "const p=JSON.parse(fs.readFileSync('package.json','utf8'));",
          "process.stdout.write(JSON.stringify({hasPackageLock:fs.existsSync('package-lock.json'),scripts:p.scripts||{}}));"
        ].join("")
      ],
      workdir: this.projectRoot,
      timeoutMs: 30_000
    });
    if (result.exitCode !== 0) {
      throw new Error(`Could not inspect npm prototype: ${result.stderr || result.stdout}`);
    }

    const parsed = JSON.parse(result.stdout) as {
      hasPackageLock?: unknown;
      scripts?: Record<string, unknown>;
    };
    const scripts: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.scripts ?? {})) {
      if (typeof value === "string") {
        scripts[name] = value;
      }
    }
    return { hasPackageLock: parsed.hasPackageLock === true, scripts };
  }

  private selectStartCommand(scripts: Readonly<Record<string, string>>): StartCommand | undefined {
    for (const strategy of ["dev", "start", "preview"] as const) {
      const script = scripts[strategy];
      if (script === undefined) {
        continue;
      }

      const isVite = /(^|[\s;&|])vite([\s;&|]|$)/.test(script);
      const npmArgv = strategy === "start"
        ? ["npm", "start"]
        : ["npm", "run", strategy];
      const argv = isVite
        ? [...npmArgv, "--", "--host", "127.0.0.1", "--port", String(this.port)]
        : npmArgv;

      return {
        strategy,
        argv,
        env: {
          HOST: "127.0.0.1",
          PORT: String(this.port)
        }
      };
    }
    return undefined;
  }

  private async launchInBackground(
    handle: WorkspaceHandle,
    start: StartCommand
  ) {
    const encoded = Buffer.from(JSON.stringify({ argv: start.argv, env: start.env }), "utf8").toString("base64");
    return this.provider.exec(handle, {
      argv: [
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          `rm -f ${PID_FILE} ${LOG_FILE}`,
          `export AGENT_WORKSPACE_START_B64='${encoded}'`,
          "node -e 'const {spawn}=require(\"child_process\"); const spec=JSON.parse(Buffer.from(process.env.AGENT_WORKSPACE_START_B64,\"base64\").toString(\"utf8\")); const out=require(\"fs\").openSync(\"/tmp/agent-workspace-prototype.log\",\"a\"); const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:process.cwd(),env:{...process.env,...spec.env},detached:true,stdio:[\"ignore\",out,out]}); child.unref(); require(\"fs\").writeFileSync(\"/tmp/agent-workspace-prototype.pid\",String(child.pid)); process.stdout.write(String(child.pid));'"
        ].join(" && ")
      ],
      workdir: this.projectRoot,
      timeoutMs: 30_000
    });
  }

  private readinessCommand(): Command {
    const attempts = Math.max(1, Math.ceil(this.readinessTimeoutMs / 500));
    return {
      argv: [
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          `for i in $(seq 1 ${attempts}); do`,
          `  if curl -fsS http://127.0.0.1:${this.port}/ >/dev/null; then exit 0; fi;`,
          `  if [ -f ${PID_FILE} ] && ! kill -0 \"$(cat ${PID_FILE})\" 2>/dev/null; then echo 'Prototype process exited before readiness' >&2; cat ${LOG_FILE} >&2 || true; exit 2; fi;`,
          "  sleep 0.5;",
          "done;",
          `echo 'Prototype readiness timed out' >&2; cat ${LOG_FILE} >&2 || true; exit 1`
        ].join("\n")
      ],
      workdir: this.projectRoot,
      timeoutMs: this.readinessTimeoutMs + 5_000
    };
  }

  private async cleanupProcess(handle: WorkspaceHandle): Promise<void> {
    await this.provider.exec(handle, {
      argv: [
        "bash",
        "-lc",
        `if [ -f ${PID_FILE} ]; then pid=$(cat ${PID_FILE}); kill \"$pid\" 2>/dev/null || true; sleep 0.2; kill -9 \"$pid\" 2>/dev/null || true; rm -f ${PID_FILE}; fi`
      ],
      workdir: this.projectRoot,
      timeoutMs: 10_000
    }).catch(() => undefined);
  }

  private failure(
    startedAt: number,
    failedStep: PrototypeFailureStep,
    exitCode: number | undefined,
    stdout: string,
    stderr: string
  ): PrototypeFailedResult {
    return {
      status: "FAILED",
      failedStep,
      ...(exitCode !== undefined ? { exitCode } : {}),
      failureSummary: failureSummary(stdout, stderr),
      logExcerpt: failureExcerpt(stdout, stderr, this.maxFailureExcerptChars),
      durationMs: Math.max(0, this.nowMs() - startedAt)
    };
  }
}
