import type { Command, SandboxProvider, WorkspaceHandle } from "../core/sandbox-provider.js";
import { boundLog, failureExcerpt, failureSummary } from "./log-bounds.js";
import type { ProjectVerificationResult, VerificationStepResult } from "./verification-result.js";

export interface PythonVerifierOptions {
  projectRoot?: string;
  installTimeoutMs?: number;
  commandTimeoutMs?: number;
  nowMs?: () => number;
}

const VENV = ".agent-workspace-venv";
const PYTHON = `${VENV}/bin/python`;
// This inspection runs inside the isolated sandbox, and only reads metadata.
const INSPECT = [
  "from pathlib import Path",
  "import json, importlib.util",
  "root = Path('.')",
  "tests = root / 'tests'",
  "unit = any(root.glob('test*.py')) or (tests.exists() and any(tests.rglob('test*.py')))",
  "print(json.dumps({'requirements':(root/'requirements.txt').is_file(),'pyproject':(root/'pyproject.toml').is_file(),'uvlock':(root/'uv.lock').is_file(),'tests':bool(unit),'pytest':importlib.util.find_spec('pytest') is not None}))"
].join("\n");

interface Inspection {
  requirements: boolean;
  pyproject: boolean;
  uvlock: boolean;
  tests: boolean;
  pytest: boolean;
}

export class PythonVerifier {
  private readonly root: string;
  private readonly nowMs: () => number;
  private readonly installTimeoutMs: number;
  private readonly commandTimeoutMs: number;

  constructor(private readonly provider: SandboxProvider, options: PythonVerifierOptions = {}) {
    this.root = options.projectRoot ?? "/workspace/project";
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.installTimeoutMs = options.installTimeoutMs ?? 5 * 60_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 3 * 60_000;
  }

  async verify(handle: WorkspaceHandle): Promise<ProjectVerificationResult> {
    const start = this.nowMs();
    const steps: VerificationStepResult[] = [];
    const initial = await this.inspect(handle, "python3", 30_000);
    if (!initial) return this.blocked(start, steps, "Cannot inspect Python project metadata");
    if (initial.uvlock && !initial.requirements) {
      return this.blocked(start, steps, "uv.lock without requirements.txt is not yet supported; an explicit locked pip requirements file is required");
    }
    const venv = await this.run(handle, "venv", ["python3", "-m", "venv", VENV], this.commandTimeoutMs);
    steps.push(venv);
    if (venv.status === "FAILED") return this.failure(start, steps, venv);

    if (initial.requirements) {
      const install = await this.run(handle, "dependencies", [PYTHON, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", "requirements.txt"], this.installTimeoutMs);
      steps.push(install);
      if (install.status === "FAILED") return this.failure(start, steps, install);
    }
    if (initial.pyproject) {
      const install = await this.run(handle, "project-install", [PYTHON, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-e", "."], this.installTimeoutMs);
      steps.push(install);
      if (install.status === "FAILED") return this.failure(start, steps, install);
    }
    const installed = await this.inspect(handle, PYTHON, 30_000);
    if (!installed) return this.blocked(start, steps, "Cannot inspect Python test dependencies");
    if (!installed.tests) return this.blocked(start, steps, "No Python test files detected; verification cannot be marked PASSED");
    const argv = installed.pytest ? [PYTHON, "-m", "pytest", "-q"] : [PYTHON, "-m", "unittest", "discover", "-s", "tests", "-p", "test*.py"];
    // unittest discover -s tests requires a tests/ directory; detect root-only tests.
    if (!installed.pytest && initial.tests) {
      const rootTest = await this.provider.exec(handle, {
        argv: ["python3", "-c", "from pathlib import Path;print('root' if any(Path('.').glob('test*.py')) else 'tests')"],
        workdir: this.root, timeoutMs: 30_000
      });
      if (rootTest.exitCode !== 0) return this.blocked(start, steps, "Cannot determine unittest discovery root");
      argv[argv.indexOf("tests")] = rootTest.stdout.trim() === "root" ? "." : "tests";
    }
    const test = await this.run(handle, "test", argv, this.commandTimeoutMs);
    steps.push(test);
    if (test.status === "FAILED") {
      if (installed.pytest && test.exitCode === 5) return this.blocked(start, steps, "pytest did not collect any tests");
      return this.failure(start, steps, test);
    }
    if (!installed.pytest && /Ran 0 tests?\b/.test(test.stdout + "\n" + test.stderr)) {
      return this.blocked(start, steps, "unittest discovered zero tests");
    }
    return { status: "PASSED", projectType: "PYTHON", durationMs: Math.max(0, this.nowMs() - start), steps };
  }

  private async inspect(handle: WorkspaceHandle, executable: string, timeoutMs: number): Promise<Inspection | undefined> {
    const result = await this.provider.exec(handle, { argv: [executable, "-c", INSPECT], workdir: this.root, timeoutMs });
    if (result.exitCode !== 0) return undefined;
    try {
      const value: unknown = JSON.parse(result.stdout);
      if (typeof value !== "object" || value === null) return undefined;
      const v = value as Record<string, unknown>;
      if (["requirements", "pyproject", "uvlock", "tests", "pytest"].some(key => typeof v[key] !== "boolean")) return undefined;
      return v as unknown as Inspection;
    } catch { return undefined; }
  }

  private async run(handle: WorkspaceHandle, name: string, argv: string[], timeoutMs: number): Promise<VerificationStepResult> {
    const start = this.nowMs();
    const command: Command = { argv, workdir: this.root, timeoutMs };
    const result = await this.provider.exec(handle, command);
    return { name, argv, status: result.exitCode === 0 ? "PASSED" : "FAILED",
      exitCode: result.exitCode, durationMs: Math.max(0, this.nowMs() - start),
      stdout: boundLog(result.stdout), stderr: boundLog(result.stderr) };
  }

  private failure(start: number, steps: VerificationStepResult[], failed: VerificationStepResult): ProjectVerificationResult {
    return { status: "FAILED", projectType: "PYTHON", durationMs: Math.max(0, this.nowMs() - start),
      steps, failedStep: failed.name, exitCode: failed.exitCode,
      failureSummary: failureSummary(failed.stdout, failed.stderr),
      logExcerpt: failureExcerpt(failed.stdout, failed.stderr) };
  }

  private blocked(start: number, steps: VerificationStepResult[], reason: string): ProjectVerificationResult {
    return { status: "BLOCKED", projectType: "PYTHON", durationMs: Math.max(0, this.nowMs() - start),
      steps, failureSummary: reason };
  }
}
