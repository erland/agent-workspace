import type { SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import type { ProjectVerifier } from "./verifier-registry.js";
import type { ProjectVerificationResult, VerificationStepResult } from "./verification-result.js";
import { boundLog, failureExcerpt, failureSummary } from "./log-bounds.js";

/** Runs only in the pinned Rust image; never installs toolchains or OS packages. */
export class CargoVerifier implements ProjectVerifier {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: { projectRoot: string; nowMs?: () => number } = { projectRoot: "/workspace/project" }
  ) {}

  async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const now = this.options.nowMs ?? Date.now;
    const started = now();
    const steps: VerificationStepResult[] = [];
    const blocked = (reason: string): ProjectVerificationResult => ({
      status: "BLOCKED", projectType: "CARGO", durationMs: Math.max(0, now() - started), steps,
      failureSummary: reason
    });
    const probe = await this.provider.exec(handle, {
      argv: ["bash", "-lc", "test -f Cargo.toml && test ! -f rust-toolchain && test ! -f rust-toolchain.toml"],
      workdir: this.options.projectRoot, timeoutMs: 30_000
    });
    if (probe.exitCode !== 0) {
      return blocked("Cargo.toml is required; project-defined rust-toolchain files are not yet supported (pinned runtime toolchain only)");
    }
    const commands: Array<[string, string[]]> = [
      ["format", ["cargo", "fmt", "--all", "--", "--check"]],
      ["check", ["cargo", "check", "--workspace", "--all-targets"]],
      ["clippy", ["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
      ["test", ["cargo", "test", "--workspace", "--all-targets"]]
    ];
    for (const [name, argv] of commands) {
      const began = now();
      const output = await this.provider.exec(handle, {
        argv, workdir: this.options.projectRoot, timeoutMs: 5 * 60_000
      });
      const step: VerificationStepResult = {
        name, argv, exitCode: output.exitCode, status: output.exitCode === 0 ? "PASSED" : "FAILED",
        durationMs: Math.max(0, now() - began),
        stdout: boundLog(output.stdout), stderr: boundLog(output.stderr)
      };
      steps.push(step);
      if (step.status === "FAILED") {
        return { status: "FAILED", projectType: "CARGO", durationMs: Math.max(0, now() - started), steps,
          failedStep: name, exitCode: output.exitCode,
          failureSummary: failureSummary(step.stdout, step.stderr),
          logExcerpt: failureExcerpt(step.stdout, step.stderr) };
      }
      if (name === "test") {
        const executed = [...(output.stdout + "\n" + output.stderr).matchAll(/running (\d+) tests?\b/g)]
          .reduce((sum, match) => sum + Number(match[1]), 0);
        if (executed < 1) return blocked("Cargo completed, but no executed tests were reported; verification cannot be PASSED");
      }
    }
    return { status: "PASSED", projectType: "CARGO", durationMs: Math.max(0, now() - started), steps };
  }
}
