import type { NetworkPolicy } from "../core/sandbox-provider.js";

export interface SecurityPolicy {
  maxActiveWorkspacesPerUser: number;
  workspaceCpu: number;
  workspaceCpuLimit: number;
  workspaceMemoryMiB: number;
  maxWorkspaceLifetimeMinutes: number;
  requestRateLimitPerMinute: number;
  oauthRegistrationRateLimitPerMinute: number;
  maxScreenshotBytes: number;
  maxArtifactBytes: number;
  networkPolicy: NetworkPolicy;
}

export const DEFAULT_DEPENDENCY_DOMAINS = [
  "*.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "deb.nodesource.com",
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "services.gradle.org",
  "downloads.gradle.org",
  "plugins.gradle.org",
  "plugins-artifacts.gradle.org",
  "repo.maven.apache.org",
  "repo1.maven.org",
  "github.com",
  "*.githubusercontent.com",
  "cdn.playwright.dev",
  "storage.googleapis.com",
  "playwright.download.prss.microsoft.com",
  "playwright.azureedge.net"
] as const;

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxActiveWorkspacesPerUser: 3,
  workspaceCpu: 1,
  workspaceCpuLimit: 2,
  workspaceMemoryMiB: 2048,
  maxWorkspaceLifetimeMinutes: 60,
  requestRateLimitPerMinute: 60,
  oauthRegistrationRateLimitPerMinute: 20,
  maxScreenshotBytes: 10 * 1024 * 1024,
  maxArtifactBytes: 100 * 1024 * 1024,
  networkPolicy: {
    outboundDomainAllowlist: [...DEFAULT_DEPENDENCY_DOMAINS],
    outboundCidrAllowlist: []
  }
};
