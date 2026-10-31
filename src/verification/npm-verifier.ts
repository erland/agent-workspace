import { NODE_PROJECT_INSPECTION, selectNodePackageManager } from "../project/node-package-manager.js";
import type {
  Command,
  SandboxProvider,
  WorkspaceHandle
} from "../core/sandbox-provider.js";
import { boundLog, failureExcerpt, failureSummary } from "./log-bounds.js";
import type {
  ProjectVerificationResult,
  VerificationStepResult
} from "./verification-result.js";

export interface NpmVerifierOptions {
  projectRoot?: string;
  installTimeoutMs?: number;
  commandTimeoutMs?: number;
  maxStepLogChars?: number;
  maxFailureExcerptChars?: number;
  nowMs?: () => number;
  playwrightRuntime?: boolean;
}

interface PackageScripts {
  test?: string;
  build?: string;
  playwright?: string;
}

const DEFAULT_PROJECT_ROOT = "/workspace/project";
const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 3 * 60_000;

export class NpmVerifier {
  private readonly projectRoot: string;
  private readonly installTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly maxStepLogChars: number | undefined;
  private readonly maxFailureExcerptChars: number | undefined;
  private readonly nowMs: () => number;
  private readonly playwrightRuntime: boolean;

  public constructor(
    private readonly provider: SandboxProvider,
    options: NpmVerifierOptions = {}
  ) {
    this.projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
    this.installTimeoutMs = options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.maxStepLogChars = options.maxStepLogChars;
    this.maxFailureExcerptChars = options.maxFailureExcerptChars;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.playwrightRuntime = options.playwrightRuntime === true;
  }

  public async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const startedAt = this.nowMs();
    const steps: VerificationStepResult[] = [];

    const packageInfo = await this.inspectPackage(handle);
    const selected = selectNodePackageManager(packageInfo);
    const installArgv = selected.install;

    const install = await this.runStep(handle, "install", {
      argv: installArgv,
      workdir: this.projectRoot,
      timeoutMs: this.installTimeoutMs
    });
    steps.push(install);
    if (install.status === "FAILED") {
      return this.failedResult(startedAt, steps, install);
    }

    if (packageInfo.scripts.test !== undefined) {
      const test = await this.runStep(handle, "test", {
        argv: selected.test,
        workdir: this.projectRoot,
        timeoutMs: this.commandTimeoutMs
      });
      steps.push(test);
      if (test.status === "FAILED") {
        return this.failedResult(startedAt, steps, test);
      }
    }

    // An explicit browser test script avoids running arbitrary Playwright commands
    // for ordinary Node projects and prevents a duplicate npm test run.
    if (this.playwrightRuntime && packageInfo.scripts.playwright !== undefined) {
      const browserTest = await this.runStep(handle, "playwright", {
        argv: [selected.manager, "run", "test:playwright"],
        env: { PLAYWRIGHT_JSON_OUTPUT_NAME: "playwright-results.json" },
        workdir: this.projectRoot,
        timeoutMs: this.commandTimeoutMs
      });
      steps.push(browserTest);
      if (browserTest.status === "FAILED") {
        return this.failedResult(startedAt, steps, browserTest);
      }
    }

    if (packageInfo.scripts.build !== undefined) {
      const build = await this.runStep(handle, "build", {
        argv: selected.build,
        workdir: this.projectRoot,
        timeoutMs: this.commandTimeoutMs
      });
      steps.push(build);
      if (build.status === "FAILED") {
        return this.failedResult(startedAt, steps, build);
      }
    }

    return {
      status: "PASSED",
      projectType: "NPM",
      durationMs: Math.max(0, this.nowMs() - startedAt),
      steps
    };
  }

  private async inspectPackage(handle: WorkspaceHandle): Promise<{
    hasPackageLock: boolean;
    hasPnpmLock: boolean;
    packageManager?: string;
    scripts: PackageScripts;
  }> {
    const command = ["node", "-e", NODE_PROJECT_INSPECTION];
    const result = await this.provider.exec(handle, {
      argv: command,
      workdir: this.projectRoot,
      timeoutMs: 30_000
    });
    if (result.exitCode !== 0) {
      throw new Error(`Could not inspect npm project: ${result.stderr || result.stdout}`);
    }
    try {
      const parsed = JSON.parse(result.stdout) as {
        hasPackageLock?: unknown;
        hasPnpmLock?: unknown;
        packageManager?: unknown;
        scripts?: Record<string, unknown>;
      };
      return {
        hasPackageLock: parsed.hasPackageLock === true,
        hasPnpmLock: parsed.hasPnpmLock === true,
        ...(typeof parsed.packageManager === "string" ? { packageManager: parsed.packageManager } : {}),
        scripts: {
          ...(typeof parsed.scripts?.test === "string" ? { test: parsed.scripts.test } : {}),
          ...(typeof parsed.scripts?.build === "string" ? { build: parsed.scripts.build } : {}),
          ...(typeof parsed.scripts?.["test:playwright"] === "string" ? { playwright: parsed.scripts["test:playwright"] } : {})
        }
      };
    } catch (error) {
      throw new Error(`Could not parse npm project metadata: ${String(error)}`);
    }
  }

  private async runStep(
    handle: WorkspaceHandle,
    name: string,
    command: Command
  ): Promise<VerificationStepResult> {
    const startedAt = this.nowMs();
    const result = await this.provider.exec(handle, command);
    return {
      name,
      argv: [...command.argv],
      status: result.exitCode === 0 ? "PASSED" : "FAILED",
      exitCode: result.exitCode,
      durationMs: Math.max(0, this.nowMs() - startedAt),
      stdout: boundLog(result.stdout, this.maxStepLogChars),
      stderr: boundLog(result.stderr, this.maxStepLogChars)
    };
  }

  private failedResult(
    startedAt: number,
    steps: VerificationStepResult[],
    failed: VerificationStepResult
  ): ProjectVerificationResult {
    return {
      status: "FAILED",
      projectType: "NPM",
      durationMs: Math.max(0, this.nowMs() - startedAt),
      steps,
      failedStep: failed.name,
      exitCode: failed.exitCode,
      failureSummary: failureSummary(failed.stdout, failed.stderr),
      logExcerpt: failureExcerpt(
        failed.stdout,
        failed.stderr,
        this.maxFailureExcerptChars
      )
    };
  }
}
