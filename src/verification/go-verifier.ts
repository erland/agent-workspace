import path from "node:path";
import type { SandboxProvider, WorkspaceHandle, Command } from "../core/sandbox-provider.js";
import type { ProjectVerifier } from "./verifier-registry.js";
import type { ProjectVerificationResult, VerificationStepResult } from "./verification-result.js";
import { boundLog, failureExcerpt, failureSummary } from "./log-bounds.js";

/** Go projects run only in the pinned Go runtime, without toolchain auto-download. */
export class GoVerifier implements ProjectVerifier {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly options: { projectRoot: string; nowMs?: () => number } = { projectRoot: "/workspace/project" }
  ) {}

  async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const now = this.options.nowMs ?? Date.now;
    const started = now();
    const steps: VerificationStepResult[] = [];
    const blocked = (reason: string): ProjectVerificationResult => ({
      status: "BLOCKED", projectType: "GO", durationMs: Math.max(0, now() - started),
      steps, failureSummary: reason
    });
    const probe = await this.provider.exec(handle, {
      argv: ["bash", "-lc", "if [ -f go.work ]; then echo workspace; elif [ -f go.mod ]; then echo module; else exit 2; fi"],
      workdir: this.options.projectRoot, timeoutMs: 30_000
    });
    if (probe.exitCode !== 0) return blocked("Go verification requires a go.mod or go.work manifest");
    let roots = [this.options.projectRoot];
    if (probe.stdout.trim() === "workspace") {
      const metadata = await this.provider.exec(handle, {
        argv: ["go", "work", "edit", "-json"],
        workdir: this.options.projectRoot, timeoutMs: 30_000
      });
      if (metadata.exitCode !== 0) return blocked("Cannot inspect go.work: " + failureSummary(metadata.stdout, metadata.stderr));
      try {
        const parsed: unknown = JSON.parse(metadata.stdout);
        if (!parsed || typeof parsed !== "object" || !("Use" in parsed) || !Array.isArray(parsed.Use)) {
          return blocked("go.work contains no valid Use module list");
        }
        const entries: unknown[] = parsed.Use;
        if (entries.length === 0 || entries.length > 12) return blocked("go.work must reference 1–12 local modules");
        const root = path.posix.resolve(this.options.projectRoot);
        const selected: string[] = [];
        for (const entry of entries) {
          if (!entry || typeof entry !== "object" || !("DiskPath" in entry) || typeof entry.DiskPath !== "string") {
            return blocked("go.work contains an invalid module path");
          }
          const relative: string = entry.DiskPath;
          const directory = path.posix.resolve(root, relative);
          if (path.posix.isAbsolute(relative) || (directory !== root && !directory.startsWith(root + "/"))) {
            return blocked("go.work module path escapes the uploaded project");
          }
          selected.push(directory);
        }
        roots = [...new Set(selected)];
      } catch {
        return blocked("Cannot parse go.work metadata");
      }
    } else if (probe.stdout.trim() !== "module") {
      return blocked("Cannot determine Go project manifest type");
    }

    for (const root of roots) {
      const prefix = roots.length === 1 ? "" : path.posix.relative(this.options.projectRoot, root) + ":";
      const tasks: Array<[string, readonly string[]]> = [
        ["format", ["bash", "-lc", "set -euo pipefail; files=$(find . -type f -name '*.go' -not -path '*/vendor/*' -not -path '*/.git/*' -print0 | xargs -0 -r gofmt -l); if [ -n \"$files\" ]; then printf '%s\\n' \"$files\"; exit 1; fi"]],
        ["dependencies", ["go", "mod", "download"]],
        ["vet", ["go", "vet", "./..."]],
        ["test", ["go", "test", "-json", "-count=1", "./..."]]
      ];
      for (const [name, argv] of tasks) {
        const began = now();
        const result = await this.provider.exec(handle, {
          argv, workdir: root, timeoutMs: name === "dependencies" || name === "test" ? 5 * 60_000 : 3 * 60_000,
          env: { GOTOOLCHAIN: "local", CGO_ENABLED: "0" }
        } satisfies Command);
        const step: VerificationStepResult = {
          name: prefix + name, argv, exitCode: result.exitCode,
          status: result.exitCode === 0 ? "PASSED" : "FAILED",
          durationMs: Math.max(0, now() - began),
          stdout: boundLog(result.stdout), stderr: boundLog(result.stderr)
        };
        steps.push(step);
        if (step.status === "FAILED") {
          return {
            status: "FAILED", projectType: "GO", durationMs: Math.max(0, now() - started),
            steps, failedStep: step.name, exitCode: step.exitCode,
            failureSummary: failureSummary(step.stdout, step.stderr),
            logExcerpt: failureExcerpt(step.stdout, step.stderr)
          };
        }
        if (name === "test") {
          // go test -json emits one pass event per executed test, including subtests.
          // Package pass events and cached/no-test packages do not count as tests.
          let executed = 0;
          for (const line of result.stdout.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const item: unknown = JSON.parse(line);
              if (item && typeof item === "object" && "Action" in item && item.Action === "pass" &&
                  "Test" in item && typeof item.Test === "string") executed++;
            } catch { /* A non-JSON diagnostic is not evidence that a test executed. */ }
          }
          if (executed === 0) return blocked("Go test completed without reporting an executed test; verification cannot be PASSED");
        }
      }
    }
    return { status: "PASSED", projectType: "GO", durationMs: Math.max(0, now() - started), steps };
  }
}
