import { redactSensitiveText } from "../security/redaction.js";

export const DEFAULT_STEP_LOG_LIMIT = 16_000;
export const DEFAULT_FAILURE_EXCERPT_LIMIT = 4_000;
export const DEFAULT_FAILURE_SUMMARY_LIMIT = 500;

export function boundLog(text: string, maxChars = DEFAULT_STEP_LOG_LIMIT): string {
  const safe = redactSensitiveText(text);
  if (maxChars <= 0 || safe.length <= maxChars) {
    return maxChars <= 0 ? "" : safe;
  }
  const marker = "\n...[truncated; showing tail]...\n";
  const keep = Math.max(0, maxChars - marker.length);
  return marker + safe.slice(-keep);
}

export function failureExcerpt(
  stdout: string,
  stderr: string,
  maxChars = DEFAULT_FAILURE_EXCERPT_LIMIT
): string {
  const combined = [redactSensitiveText(stderr).trim(), redactSensitiveText(stdout).trim()].filter(Boolean).join("\n--- stdout ---\n");
  return boundLog(combined, maxChars);
}

export function failureSummary(
  stdout: string,
  stderr: string,
  maxChars = DEFAULT_FAILURE_SUMMARY_LIMIT
): string {
  const source = redactSensitiveText(stderr).trim() || redactSensitiveText(stdout).trim() || "Command failed without output";
  const line = source.split(/\r?\n/).find((value) => value.trim().length > 0) ?? source;
  return line.length <= maxChars ? line : `${line.slice(0, Math.max(0, maxChars - 3))}...`;
}
