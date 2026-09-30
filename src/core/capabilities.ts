import {
  DEFAULT_JAVA_VERSION,
  DEFAULT_NODE_VERSION,
  RUNTIME_PROFILES,
  SUPPORTED_JAVA_VERSIONS,
  SUPPORTED_NODE_VERSIONS,
  type RuntimeProfileId
} from "./runtime-profile.js";

export interface AgentWorkspaceCapabilities {
  provider: {
    id: "modal";
    runtimeProfiles: RuntimeProfileId[];
  };
  runtimes: {
    java: {
      supported: readonly string[];
      default: string;
    };
    node: {
      supported: readonly string[];
      default: string;
    };
  };
  buildSystems: readonly ["maven", "npm"];
  browser: {
    chromium: boolean;
    screenshots: boolean;
  };
  workspace: {
    defaultLifetimeMinutes: number;
    maxLifetimeMinutes: number;
  };
}

export function getCapabilities(): AgentWorkspaceCapabilities {
  return {
    provider: {
      id: "modal",
      runtimeProfiles: Object.keys(RUNTIME_PROFILES).sort() as RuntimeProfileId[]
    },
    runtimes: {
      java: {
        supported: [...SUPPORTED_JAVA_VERSIONS],
        default: DEFAULT_JAVA_VERSION
      },
      node: {
        supported: [...SUPPORTED_NODE_VERSIONS],
        default: DEFAULT_NODE_VERSION
      }
    },
    buildSystems: ["maven", "npm"],
    browser: {
      chromium: true,
      screenshots: true
    },
    workspace: {
      defaultLifetimeMinutes: 30,
      maxLifetimeMinutes: 60
    }
  };
}
