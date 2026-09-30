import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InMemoryExecutionAccountRepository,
  InMemoryExternalIdentityRepository,
  InMemoryUserRepository,
  InMemoryWorkspaceRepository
} from "../src/persistence/in-memory.js";
import { IdentityService } from "../src/persistence/identity-service.js";
import { RepositoryProfileProvider } from "../src/persistence/profile-provider.js";

describe("multi-user identity persistence", () => {
  it("resolves the same issuer+subject to the same user and isolates another subject", async () => {
    const users = new InMemoryUserRepository();
    const identities = new InMemoryExternalIdentityRepository();
    const accounts = new InMemoryExecutionAccountRepository();
    let next = 0;
    const service = new IdentityService(users, identities, accounts, {
      now: () => new Date("2026-09-29T18:00:00.000Z"),
      idFactory: (kind) => `${kind}-${++next}`
    });

    const first = await service.resolveOrCreateUser({ issuer: "https://issuer.example", subject: "alice", displayName: "Alice" });
    const again = await service.resolveOrCreateUser({ issuer: "https://issuer.example", subject: "alice" });
    const second = await service.resolveOrCreateUser({ issuer: "https://issuer.example", subject: "bob" });

    assert.equal(first.id, again.id);
    assert.notEqual(first.id, second.id);
  });

  it("stores one execution account per user and reports connection state", async () => {
    const users = new InMemoryUserRepository();
    const identities = new InMemoryExternalIdentityRepository();
    const accounts = new InMemoryExecutionAccountRepository();
    await users.create({
      id: "user-1", displayName: "Alice", status: "ACTIVE",
      createdAt: "2026-09-29T18:00:00.000Z", updatedAt: "2026-09-29T18:00:00.000Z"
    });
    await accounts.upsert({
      id: "ea-1", userId: "user-1", provider: "modal", credentialRef: "cred-1",
      status: "CONNECTED", createdAt: "2026-09-29T18:00:00.000Z", updatedAt: "2026-09-29T18:00:00.000Z"
    });

    const profile = await new RepositoryProfileProvider("user-1", users, accounts).getProfile();
    assert.equal(profile.user.displayName, "Alice");
    assert.equal(profile.execution.provider, "modal");
    assert.equal(profile.execution.connected, true);
  });

  it("enforces user ownership when loading workspaces", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    await workspaces.upsert({
      id: "ws-1", userId: "user-1", providerId: "modal", providerWorkspaceId: "sb-1",
      runtimeProfile: "java21-node22", status: "READY",
      createdAt: "2026-09-29T18:00:00.000Z", expiresAt: "2026-09-29T18:30:00.000Z"
    });

    assert.ok(await workspaces.findByIdForUser("ws-1", "user-1"));
    assert.equal(await workspaces.findByIdForUser("ws-1", "user-2"), undefined);
  });
});
