import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import type { ProjectVerificationResult, VerificationStepResult } from "./verification-result.js";
import type { ProjectVerifier } from "./verifier-registry.js";
import { boundLog, failureExcerpt, failureSummary } from "./log-bounds.js";

/** Gradle Wrapper is mandatory: the runtime images do not bundle a global Gradle version. */
export class GradleVerifier implements ProjectVerifier {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: { projectRoot: string; nowMs?: () => number } = { projectRoot: "/workspace/project" }
  ) {}

  async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const now = this.options.nowMs ?? (() => Date.now());
    const start = now();
    const steps: VerificationStepResult[] = [];
    const probe = await this.provider.exec(handle, {
      argv: ["bash", "-lc", "test -f ./gradlew && test -f ./gradle/wrapper/gradle-wrapper.jar && test -f ./gradle/wrapper/gradle-wrapper.properties"],
      workdir: this.options.projectRoot, timeoutMs: 30_000
    });
    if (probe.exitCode !== 0) {
      return {status: "BLOCKED", projectType: "GRADLE", durationMs: Math.max(0, now() - start), steps,
        failureSummary: "Gradle Wrapper files (gradlew, gradle-wrapper.jar, gradle-wrapper.properties) are required"};
    }
    const command = ["bash", "./gradlew", "--no-daemon", "--console=plain", "test"];
    const began = now();
    const result = await this.provider.exec(handle, {argv: command, workdir: this.options.projectRoot, timeoutMs: 5 * 60_000});
    const step: VerificationStepResult = {
      name: "test", argv: command, exitCode: result.exitCode,
      status: result.exitCode === 0 ? "PASSED" : "FAILED",
      durationMs: Math.max(0, now() - began),
      stdout: boundLog(result.stdout), stderr: boundLog(result.stderr)
    };
    steps.push(step);
    if (step.status === "FAILED") {
      return {status: "FAILED", projectType: "GRADLE", durationMs: Math.max(0, now() - start), steps,
        failedStep: "test", exitCode: step.exitCode,
        failureSummary: failureSummary(step.stdout, step.stderr),
        logExcerpt: failureExcerpt(step.stdout, step.stderr)};
    }
    return {status: "PASSED", projectType: "GRADLE", durationMs: Math.max(0, now() - start), steps};
  }
}
