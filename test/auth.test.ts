import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRemoteOAuthConfig, protectedResourceMetadata, protectedResourceMetadataUrl } from "../src/auth/oauth-config.js";
import { principalFromAuthInfo } from "../src/auth/principal.js";

describe("remote OAuth configuration", () => {
  it("builds ChatGPT/MCP compatible resource metadata", () => {
    const config = loadRemoteOAuthConfig({
      AGENT_WORKSPACE_PUBLIC_BASE_URL: "https://workspace.example/",
      AGENT_WORKSPACE_OAUTH_ISSUER: "https://login.example/",
      AGENT_WORKSPACE_OAUTH_JWKS_URI: "https://login.example/.well-known/jwks.json"
    });
    assert.equal(config.mcpUrl, "https://workspace.example/mcp");
    assert.equal(config.audience, "https://workspace.example/mcp");
    assert.equal(protectedResourceMetadataUrl(config), "https://workspace.example/.well-known/oauth-protected-resource/mcp");
    assert.deepEqual(protectedResourceMetadata(config), {
      resource: "https://workspace.example/mcp",
      authorization_servers: ["https://login.example/"],
      scopes_supported: ["agent-workspace"],
      bearer_methods_supported: ["header"]
    });
  });

  it("rejects insecure non-local public endpoints", () => {
    assert.throws(() => loadRemoteOAuthConfig({
      AGENT_WORKSPACE_PUBLIC_BASE_URL: "http://workspace.example/",
      AGENT_WORKSPACE_OAUTH_ISSUER: "https://login.example/",
      AGENT_WORKSPACE_OAUTH_JWKS_URI: "https://login.example/jwks"
    }), /https/);
  });
});

describe("principalFromAuthInfo", () => {
  it("maps issuer/subject identity without exposing bearer token", () => {
    const principal = principalFromAuthInfo({
      token: "secret-token",
      clientId: "chatgpt-client",
      scopes: ["agent-workspace"],
      expiresAt: 2_000_000_000,
      extra: { issuer: "https://login.example/", subject: "person-1", email: "a@example.test", displayName: "A" }
    });
    assert.deepEqual(principal, {
      issuer: "https://login.example/",
      subject: "person-1",
      scopes: ["agent-workspace"],
      email: "a@example.test",
      displayName: "A"
    });
    assert.equal(JSON.stringify(principal).includes("secret-token"), false);
  });
});
