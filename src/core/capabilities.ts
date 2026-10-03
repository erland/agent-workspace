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
    viewportPresets: readonly ["desktop", "tablet", "mobile"];
    devicePresets: readonly ["iphone", "iphone-large", "ipad", "android", "android-large"];
    orientations: readonly ["portrait", "landscape"];
    customViewport: boolean;
    interactivePreview: boolean;
  };
  workspace: {
    defaultLifetimeMinutes: number;
    maxLifetimeMinutes: number;
    executionModel: "lazy-ephemeral";
    interactiveSandboxMaxLifetimeMinutes: number;
  };
  artifacts: {
    temporaryStorage: boolean;
    defaultLifetimeMinutes: number;
    signedDownloadLinks: boolean;
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
      screenshots: true,
      viewportPresets: ["desktop", "tablet", "mobile"],
      devicePresets: ["iphone", "iphone-large", "ipad", "android", "android-large"],
      orientations: ["portrait", "landscape"],
      customViewport: true,
      interactivePreview: true
    },
    workspace: {
      defaultLifetimeMinutes: 60,
      maxLifetimeMinutes: 60,
      executionModel: "lazy-ephemeral",
      interactiveSandboxMaxLifetimeMinutes: 20
    },
    artifacts: {
      temporaryStorage: true,
      defaultLifetimeMinutes: 60,
      signedDownloadLinks: true
    }
  };
}
