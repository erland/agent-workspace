import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { AgentOAuthServer } from "../src/auth/agent-oauth-server.js";
import { createSettingsHandler, type SettingsAuth } from "../src/http/settings.js";
import type { IdentityService } from "../src/persistence/identity-service.js";
import type { ModalCredentialManager } from "../src/execution/modal-credential-manager.js";

function handlerFor(session?: ReturnType<SettingsAuth["settingsSession"]>) {
  const auth: SettingsAuth = {
    async beginSettingsLogin() {
      return new Response(null, { status: 302, headers: { location: "https://accounts.google.com/" } });
    },
    settingsSession() {
      return session;
    },
    logoutSettings() {
      return new Response(null, { status: 302, headers: { location: "/" } });
    }
  };

  return createSettingsHandler({
    auth,
    identityService: {} as IdentityService,
    modalCredentials: {} as ModalCredentialManager
  });
}

describe("settings landing page", () => {
  it("shows a Google login action on / when logged out", async () => {
    const handler = handlerFor();
    const response = await handler(new Request("https://workspace.example/"));

    assert.ok(response);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /<h1>Agent Workspace<\/h1>/);
    assert.match(body, /href="\/settings\/login">Logga in med Google<\/a>/);
    assert.doesNotMatch(body, /Öppna inställningar/);
  });

  it("shows settings and logout actions on / when logged in", async () => {
    const handler = handlerFor({
      principal: {
        issuer: "https://accounts.google.com",
        subject: "person-1",
        scopes: [],
        email: "ada@example.test",
        displayName: "Ada"
      },
      csrf: "csrf-token"
    });
    const response = await handler(new Request("https://workspace.example/"));

    assert.ok(response);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Inloggad som Ada/);
    assert.match(body, /href="\/settings">Öppna inställningar<\/a>/);
    assert.match(body, /action="\/settings\/logout"/);
    assert.match(body, /name="csrf" value="csrf-token"/);
  });

  it("keeps /settings protected when no session exists", async () => {
    const handler = handlerFor();
    const response = await handler(new Request("https://workspace.example/settings"));

    assert.ok(response);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/settings/login");
  });
});

describe("settings logout", () => {
  it("clears the session and returns the user to /", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const server = new AgentOAuthServer(
      {
        issuer: "https://workspace.example/",
        publicBaseUrl: "https://workspace.example/",
        mcpUrl: "https://workspace.example/mcp",
        requiredScope: "agent-workspace",
        allowedEmails: [],
        googleClientId: "client.apps.googleusercontent.com",
        googleClientSecret: "secret",
        signingKey: privateKey,
        sessionSecret: "x".repeat(32),
        clientMetadataOrigins: []
      },
      {} as never,
      {} as never
    );

    const response = server.logoutSettings();

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.match(response.headers.get("set-cookie") ?? "", /aw_session=;/);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });
});
