import type { NetworkPolicy } from "../core/sandbox-provider.js";

export interface SecurityPolicy {
  maxActiveWorkspacesPerUser: number;
  workspaceCpu: number;
  workspaceCpuLimit: number;
  workspaceMemoryMiB: number;
  maxWorkspaceLifetimeMinutes: number;
  requestRateLimitPerMinute: number;
  networkPolicy: NetworkPolicy;
}

export const DEFAULT_DEPENDENCY_DOMAINS = [
  "*.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "deb.nodesource.com",
  "registry.npmjs.org",
  "repo.maven.apache.org",
  "repo1.maven.org",
  "github.com",
  "*.githubusercontent.com",
  "cdn.playwright.dev",
  "playwright.azureedge.net"
] as const;

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxActiveWorkspacesPerUser: 3,
  workspaceCpu: 1,
  workspaceCpuLimit: 2,
  workspaceMemoryMiB: 2048,
  maxWorkspaceLifetimeMinutes: 60,
  requestRateLimitPerMinute: 60,
  networkPolicy: {
    outboundDomainAllowlist: [...DEFAULT_DEPENDENCY_DOMAINS]
  }
};
