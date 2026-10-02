export const SCREENSHOT_RESOURCE_TEMPLATE = "agent-workspace://screenshots/{workspaceId}/{artifactId}";

export function screenshotResourceUri(workspaceId: string, artifactId: string): string {
  return `agent-workspace://screenshots/${encodeURIComponent(workspaceId)}/${encodeURIComponent(artifactId)}`;
}

export function singleTemplateValue(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value[0] ?? "" : value;
}
