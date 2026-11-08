export type VerificationStatus = "PASSED" | "FAILED" | "BLOCKED";
export type VerificationStepStatus = "PASSED" | "FAILED";

export interface VerificationStepResult {
  name: string;
  argv: readonly string[];
  status: VerificationStepStatus;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface ProjectVerificationResult {
  status: VerificationStatus;
  projectType: "NPM" | "MAVEN" | "PYTHON";
  durationMs: number;
  steps: VerificationStepResult[];
  failedStep?: string;
  exitCode?: number;
  failureSummary?: string;
  logExcerpt?: string;
}
