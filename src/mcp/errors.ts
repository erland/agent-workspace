import { ArchiveValidationError } from "../archive/archive-validator.js";
import { redactSensitiveText } from "../security/redaction.js";

export type AgentWorkspaceErrorCode =
  | "INVALID_INPUT"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_EXPIRED"
  | "WORKSPACE_NOT_READY"
  | "INVALID_ARCHIVE"
  | "UNSUPPORTED_PROJECT"
  | "UNSUPPORTED_RUNTIME"
  | "BUILD_FAILED"
  | "RATE_LIMITED"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export interface AgentWorkspaceErrorBody {
  error: {
    code: AgentWorkspaceErrorCode;
    message: string;
    retryable: boolean;
  };
}

export function normalizeToolError(error: unknown): AgentWorkspaceErrorBody {
  if (error instanceof ArchiveValidationError) {
    return body("INVALID_ARCHIVE", error.message, false);
  }
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  if (message.includes("Rate limit exceeded")) return body("RATE_LIMITED", message, true);
  if (message.includes("active workspace limit") || message.includes("Resource limit")) return body("RESOURCE_LIMIT_EXCEEDED", message, true);
  if (message.includes("archiveBase64") || message.includes("must be valid base64")) return body("INVALID_INPUT", message, false);
  if (message.includes("Workspace not found")) return body("WORKSPACE_NOT_FOUND", message, false);
  if (message.includes("EXPIRED")) return body("WORKSPACE_EXPIRED", message, false);
  if (message.includes("not ready")) return body("WORKSPACE_NOT_READY", message, true);
  if (message.includes("Unsupported") || message.includes("unsupported")) return body("UNSUPPORTED_RUNTIME", message, false);
  if (message.includes("project is not") || message.includes("no uploaded project")) return body("UNSUPPORTED_PROJECT", message, false);
  return body("INTERNAL_ERROR", message, false);
}

function body(code: AgentWorkspaceErrorCode, message: string, retryable: boolean): AgentWorkspaceErrorBody {
  return { error: { code, message, retryable } };
}
