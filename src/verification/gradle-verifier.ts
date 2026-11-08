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
    const command = ["bash", "./gradlew", "--no-daemon", "--console=plain", "clean", "test"];
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
    // Gradle exits successfully for NO-SOURCE test tasks. Only return PASS when
    // at least one actual test is represented in the generated XML reports.
    // clean test above prevents stale reports in the supplied archive from
    // satisfying this check.
    const reports = await this.provider.exec(handle, {
      argv: ["python3", "-c", [
        "from pathlib import Path",
        "import json, xml.etree.ElementTree as ET",
        "total = 0",
        "for p in Path('.').rglob('TEST-*.xml'):",
        "    if '/build/test-results/' not in '/' + p.as_posix(): continue",
        "    try: total += int(ET.parse(p).getroot().attrib.get('tests', '0'))",
        "    except (OSError, ValueError, ET.ParseError): pass",
        "print(json.dumps({'tests': total}))"
      ].join("\\n")],
      workdir: this.options.projectRoot, timeoutMs: 30_000
    });
    let tests = 0;
    try {
      if (reports.exitCode === 0) tests = Number(JSON.parse(reports.stdout).tests);
    } catch { /* Treat invalid report inspection as not verified. */ }
    if (!Number.isSafeInteger(tests) || tests < 1) {
      return {status: "BLOCKED", projectType: "GRADLE", durationMs: Math.max(0, now() - start), steps,
        failureSummary: "Gradle completed, but no executed tests were confirmed in test-result XML"};
    }
    return {status: "PASSED", projectType: "GRADLE", durationMs: Math.max(0, now() - start), steps};
  }
}
