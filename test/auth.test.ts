import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRemoteOAuthConfig, protectedResourceMetadata, protectedResourceMetadataUrl } from "../src/auth/oauth-config.js";
import { isPrincipalAllowed, principalFromAuthInfo } from "../src/auth/principal.js";

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
    assert.deepEqual(config.allowedEmails, []);
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

describe("OAuth user allowlist", () => {
  it("normalizes configured email addresses", () => {
    const config = loadRemoteOAuthConfig({
      AGENT_WORKSPACE_PUBLIC_BASE_URL: "https://workspace.example/",
      AGENT_WORKSPACE_OAUTH_ISSUER: "https://login.example/",
      AGENT_WORKSPACE_OAUTH_JWKS_URI: "https://login.example/.well-known/jwks.json",
      AGENT_WORKSPACE_ALLOWED_EMAILS: " A@Example.test, b@example.test ,a@example.test "
    });
    assert.deepEqual(config.allowedEmails, ["a@example.test", "b@example.test"]);
  });

  it("allows everyone when no allowlist is configured", () => {
    assert.equal(isPrincipalAllowed({
      issuer: "https://login.example/",
      subject: "person-1",
      scopes: [],
      email: "anyone@example.test"
    }, []), true);
  });

  it("allows only listed email addresses when configured", () => {
    const allowed = ["a@example.test"];
    assert.equal(isPrincipalAllowed({
      issuer: "https://login.example/",
      subject: "person-1",
      scopes: [],
      email: "A@EXAMPLE.TEST"
    }, allowed), true);
    assert.equal(isPrincipalAllowed({
      issuer: "https://login.example/",
      subject: "person-2",
      scopes: [],
      email: "b@example.test"
    }, allowed), false);
    assert.equal(isPrincipalAllowed({
      issuer: "https://login.example/",
      subject: "person-3",
      scopes: []
    }, allowed), false);
  });
});
