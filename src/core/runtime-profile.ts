import type { Command } from "./sandbox-provider.js";

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
  bootstrapCommands: readonly Command[];
}

export interface RuntimeRequest {
  java?: JavaVersion;
  node?: NodeVersion;
}

export const DEFAULT_JAVA_VERSION: JavaVersion = "21";
export const DEFAULT_NODE_VERSION: NodeVersion = "22";
export const DEFAULT_RUNTIME_PROFILE_ID: RuntimeProfileId = "java21-node22";

function createProfile(java: JavaVersion, node: NodeVersion): RuntimeProfile {
  const id = `java${java}-node${node}` as RuntimeProfileId;

  return {
    id,
    java,
    node,
    // Start from the requested JDK. Node and Maven are bootstrapped by provider-controlled
    // commands. This is intentionally simple for v1; published prebuilt images can replace
    // the bootstrap later without changing the workspace/domain API.
    imageRef: `eclipse-temurin:${java}-jdk-noble`,
    bootstrapCommands: [
      {
        argv: [
          "bash",
          "-lc",
          [
            "set -euo pipefail",
            "export DEBIAN_FRONTEND=noninteractive",
            // Modal's domain allowlist governs outbound TLS traffic on port 443.
            // Ubuntu's stock sources may still use http://, so normalize all apt
            // source files to HTTPS before the first apt-get update.
            "find /etc/apt -type f \\( -name '*.list' -o -name '*.sources' \\) -exec sed -i 's|http://|https://|g' {} +",
            "apt-get update",
            "apt-get install -y --no-install-recommends ca-certificates curl gnupg maven unzip",
            `curl -fsSL https://deb.nodesource.com/setup_${node}.x | bash -`,
            "apt-get install -y --no-install-recommends nodejs",
            "mkdir -p /opt/agent-workspace/browser-tools",
            "npm install --prefix /opt/agent-workspace/browser-tools playwright@1.55.0",
            "/opt/agent-workspace/browser-tools/node_modules/.bin/playwright install --with-deps chromium",
            "rm -rf /var/lib/apt/lists/*"
          ].join(" && ")
        ],
        timeoutMs: 5 * 60 * 1000
      }
    ]
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
