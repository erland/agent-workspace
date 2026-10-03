export const ARTIFACT_RESOURCE_TEMPLATE = "agent-workspace://artifacts/{artifactId}";

export function artifactResourceUri(artifactId: string): string {
  return `agent-workspace://artifacts/${encodeURIComponent(artifactId)}`;
}

export function singleArtifactTemplateValue(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value[0] ?? "" : value;
}
