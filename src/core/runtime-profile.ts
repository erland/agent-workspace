export const SUPPORTED_JAVA_VERSIONS = ["17", "21", "25"] as const;
export const SUPPORTED_NODE_VERSIONS = ["20", "22"] as const;

export type JavaVersion = (typeof SUPPORTED_JAVA_VERSIONS)[number];
export type NodeVersion = (typeof SUPPORTED_NODE_VERSIONS)[number];
export type RuntimeProfileId = `java${JavaVersion}-node${NodeVersion}`;

export interface RuntimeProfile {
  id: RuntimeProfileId;
  java: JavaVersion;
  node: NodeVersion;
  imageRef: string;
  bootstrapCommands: readonly [];
}

export interface RuntimeRequest {
  java?: JavaVersion;
  node?: NodeVersion;
}

export const DEFAULT_JAVA_VERSION: JavaVersion = "21";
export const DEFAULT_NODE_VERSION: NodeVersion = "22";
export const DEFAULT_RUNTIME_PROFILE_ID: RuntimeProfileId = "java21-node22";

export const DEFAULT_RUNTIME_IMAGE_PREFIX = "ghcr.io/erland/agent-workspace-runtime";
export const DEFAULT_RUNTIME_IMAGE_VERSION = "2";

function createProfile(java: JavaVersion, node: NodeVersion): RuntimeProfile {
  const id = `java${java}-node${node}` as RuntimeProfileId;
  const prefix = process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX ?? DEFAULT_RUNTIME_IMAGE_PREFIX;
  const version = process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION ?? DEFAULT_RUNTIME_IMAGE_VERSION;

  return {
    id,
    java,
    node,
    imageRef: `${prefix}:${id}-v${version}`,
    bootstrapCommands: []
  };
}

export const RUNTIME_PROFILES: Readonly<Record<RuntimeProfileId, RuntimeProfile>> = {
  "java17-node20": createProfile("17", "20"),
  "java17-node22": createProfile("17", "22"),
  "java21-node20": createProfile("21", "20"),
  "java21-node22": createProfile("21", "22"),
  "java25-node20": createProfile("25", "20"),
  "java25-node22": createProfile("25", "22")
};

export function resolveRuntimeProfile(request: RuntimeRequest = {}): RuntimeProfile {
  const java = request.java ?? DEFAULT_JAVA_VERSION;
  const node = request.node ?? DEFAULT_NODE_VERSION;
  const id = `java${java}-node${node}` as RuntimeProfileId;
  const profile = RUNTIME_PROFILES[id];

  if (profile === undefined) {
    throw new Error(`Unsupported runtime profile: ${id}`);
  }

  return profile;
}
