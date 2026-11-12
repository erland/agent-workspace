export const SUPPORTED_JAVA_VERSIONS = ["17", "21", "25"] as const;
export const SUPPORTED_NODE_VERSIONS = ["20", "22"] as const;

export type JavaVersion = (typeof SUPPORTED_JAVA_VERSIONS)[number];
export type NodeVersion = (typeof SUPPORTED_NODE_VERSIONS)[number];
export type RuntimeProfileId = `java${JavaVersion}-node${NodeVersion}` | "playwright-chromium-node22" | "rust" | "go" | "tauri-linux";

export interface RuntimeProfile {
  id: RuntimeProfileId;
  java?: JavaVersion;
  node?: NodeVersion;
  imageRef: string;
  bootstrapCommands: readonly [];
}

export interface RuntimeRequest {
  java?: JavaVersion;
  node?: NodeVersion;
  playwright?: boolean;
  rust?: boolean;
  go?: boolean;
  tauri?: boolean;
}

export const DEFAULT_JAVA_VERSION: JavaVersion = "21";
export const DEFAULT_NODE_VERSION: NodeVersion = "22";
export const DEFAULT_RUNTIME_PROFILE_ID: RuntimeProfileId = "java21-node22";

export const DEFAULT_RUNTIME_IMAGE_PREFIX = "ghcr.io/erland/agent-workspace-runtime";
export const DEFAULT_RUNTIME_IMAGE_VERSION = "9";

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
  "java25-node22": createProfile("25", "22"),
  "playwright-chromium-node22": { ...createProfile("21", "22"), id: "playwright-chromium-node22", imageRef: `${process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX ?? DEFAULT_RUNTIME_IMAGE_PREFIX}:playwright-chromium-node22-v${process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_VERSION ?? DEFAULT_RUNTIME_IMAGE_VERSION}` },
  "tauri-linux": {
    id: "tauri-linux", node: "22",
    imageRef: `${process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX ?? DEFAULT_RUNTIME_IMAGE_PREFIX}:tauri-linux-v${process.env.AGENT_WORKSPACE_TAURI_RUNTIME_IMAGE_VERSION ?? "1"}`,
    bootstrapCommands: []
  },
  go: { id: "go", imageRef: `${process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX ?? DEFAULT_RUNTIME_IMAGE_PREFIX}:go-v${process.env.AGENT_WORKSPACE_GO_RUNTIME_IMAGE_VERSION ?? "1"}`, bootstrapCommands: [] },
  rust: { id: "rust", imageRef: `${process.env.AGENT_WORKSPACE_RUNTIME_IMAGE_PREFIX ?? DEFAULT_RUNTIME_IMAGE_PREFIX}:rust-v${process.env.AGENT_WORKSPACE_RUST_RUNTIME_IMAGE_VERSION ?? "1"}`, bootstrapCommands: [] }
};

/** Enforce risk-acceptance expiry at workspace creation, even after image publication. */
export function assertTauriBuildOnlyRiskWindow(nowMs: number = Date.now()): void {
  const expiryUtc = Date.parse("2026-12-10T00:00:00Z");
  if (!Number.isFinite(nowMs) || nowMs >= expiryUtc) {
    throw new Error("Tauri Ubuntu WebKitGTK risk acceptance expired after 2026-12-09; a patched runtime is required");
  }
}

export function resolveRuntimeProfile(request: RuntimeRequest = {}): RuntimeProfile {
  if (request.go === true) {
    if (request.java !== undefined || request.node !== undefined || request.playwright === true || request.rust === true || request.tauri === true) {
      throw new Error("Go runtime cannot be combined with Java, Node, Playwright, Rust or Tauri runtime options");
    }
    return RUNTIME_PROFILES.go;
  }
  if (request.tauri === true) {
    if (request.java !== undefined || request.rust === true || request.playwright === true ||
        (request.node !== undefined && request.node !== "22")) {
      throw new Error("Tauri runtime requires Node 22 and cannot be combined with Java, Rust, Go or Playwright options");
    }
    assertTauriBuildOnlyRiskWindow();
    return RUNTIME_PROFILES["tauri-linux"];
  }
  if (request.rust === true) {
    if (request.java !== undefined || request.node !== undefined || request.playwright === true ) {
      throw new Error("Rust runtime cannot be combined with Java, Node or Playwright runtime options");
    }
    return RUNTIME_PROFILES.rust;
  }
  if (request.playwright) {
    if ((request.java !== undefined && request.java !== "21") || (request.node !== undefined && request.node !== "22")) {
      throw new Error("Playwright runtime requires Java 21 and Node 22");
    }
    return RUNTIME_PROFILES["playwright-chromium-node22"];
  }
  const java = request.java ?? DEFAULT_JAVA_VERSION;
  const node = request.node ?? DEFAULT_NODE_VERSION;
  const id = `java${java}-node${node}` as RuntimeProfileId;
  const profile = RUNTIME_PROFILES[id];

  if (profile === undefined) {
    throw new Error(`Unsupported runtime profile: ${id}`);
  }

  return profile;
}
