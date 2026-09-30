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

export interface MavenVerifierOptions {
  projectRoot?: string;
  commandTimeoutMs?: number;
  maxStepLogChars?: number;
  maxFailureExcerptChars?: number;
  nowMs?: () => number;
}

const DEFAULT_PROJECT_ROOT = "/workspace/project";
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

export class MavenVerifier {
  private readonly projectRoot: string;
  private readonly commandTimeoutMs: number;
  private readonly maxStepLogChars: number | undefined;
  private readonly maxFailureExcerptChars: number | undefined;
  private readonly nowMs: () => number;

  public constructor(
    private readonly provider: SandboxProvider,
    options: MavenVerifierOptions = {}
  ) {
    this.projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.maxStepLogChars = options.maxStepLogChars;
    this.maxFailureExcerptChars = options.maxFailureExcerptChars;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  public async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const startedAt = this.nowMs();
    const steps: VerificationStepResult[] = [];
    const executable = await this.resolveMavenExecutable(handle);

    const test = await this.runStep(handle, "test", {
      argv: [executable, "test"],
      workdir: this.projectRoot,
      timeoutMs: this.commandTimeoutMs
    });
    steps.push(test);
    if (test.status === "FAILED") {
      return this.failedResult(startedAt, steps, test);
    }

    const packageStep = await this.runStep(handle, "package", {
      argv: [executable, "package", "-DskipTests"],
      workdir: this.projectRoot,
      timeoutMs: this.commandTimeoutMs
    });
    steps.push(packageStep);
    if (packageStep.status === "FAILED") {
      return this.failedResult(startedAt, steps, packageStep);
    }

    return {
      status: "PASSED",
      projectType: "MAVEN",
      durationMs: Math.max(0, this.nowMs() - startedAt),
      steps
    };
  }

  private async resolveMavenExecutable(handle: WorkspaceHandle): Promise<"./mvnw" | "mvn"> {
    const result = await this.provider.exec(handle, {
      argv: [
        "bash",
        "-lc",
        "if [ -f ./mvnw ]; then chmod +x ./mvnw && printf './mvnw'; else printf 'mvn'; fi"
      ],
      workdir: this.projectRoot,
      timeoutMs: 30_000
    });
    if (result.exitCode !== 0) {
      throw new Error(`Could not inspect Maven project: ${result.stderr || result.stdout}`);
    }

    const executable = result.stdout.trim();
    if (executable === "./mvnw" || executable === "mvn") {
      return executable;
    }
    throw new Error(`Could not determine Maven executable: ${result.stdout}`);
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
      projectType: "MAVEN",
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
