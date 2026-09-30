import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { IdentityService } from "../persistence/identity-service.js";
import {
  PostgresExecutionAccountRepository,
  PostgresExternalIdentityRepository,
  PostgresUserRepository,
  PostgresWorkspaceRepository
} from "../persistence/postgres/repositories.js";
import { createPostgresPool, PgSqlClient } from "../persistence/postgres/pool.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Example: postgres://agent:agent@localhost:5432/agent_workspace");
}

const pool = createPostgresPool(databaseUrl);
const db = new PgSqlClient(pool);
const suffix = randomUUID().slice(0, 8);
const createdUsers: string[] = [];

try {
  const migration = await readFile(new URL("../../db/migrations/001_identity_workspace.sql", import.meta.url), "utf8");
  await pool.query(migration);

  const users = new PostgresUserRepository(db);
  const identities = new PostgresExternalIdentityRepository(db);
  const accounts = new PostgresExecutionAccountRepository(db);
  const workspaces = new PostgresWorkspaceRepository(db);
  const identityService = new IdentityService(users, identities, accounts);

  const alice = await identityService.resolveOrCreateUser({
    issuer: "https://agent-workspace.dev/smoke",
    subject: `alice-${suffix}`,
    displayName: "Alice Smoke"
  });
  const bob = await identityService.resolveOrCreateUser({
    issuer: "https://agent-workspace.dev/smoke",
    subject: `bob-${suffix}`,
    displayName: "Bob Smoke"
  });
  createdUsers.push(alice.id, bob.id);
  assert.notEqual(alice.id, bob.id);

  const now = new Date();
  await accounts.upsert({
    id: `ea-${suffix}-alice`, userId: alice.id, provider: "modal", credentialRef: `secret://alice-${suffix}`,
    status: "CONNECTED", createdAt: now.toISOString(), updatedAt: now.toISOString()
  });
  await accounts.upsert({
    id: `ea-${suffix}-bob`, userId: bob.id, provider: "modal", credentialRef: `secret://bob-${suffix}`,
    status: "CONNECTED", createdAt: now.toISOString(), updatedAt: now.toISOString()
  });
  assert.equal((await accounts.findByUserId(alice.id))?.credentialRef, `secret://alice-${suffix}`);
  assert.equal((await accounts.findByUserId(bob.id))?.credentialRef, `secret://bob-${suffix}`);

  await workspaces.upsert({
    id: `ws-${suffix}-alice`, userId: alice.id, providerId: "modal", providerWorkspaceId: "sb-alice",
    runtimeProfile: "java21-node22", status: "READY",
    createdAt: new Date(now.getTime() - 120000).toISOString(),
    expiresAt: new Date(now.getTime() - 60000).toISOString()
  });
  await workspaces.upsert({
    id: `ws-${suffix}-bob`, userId: bob.id, providerId: "modal", providerWorkspaceId: "sb-bob",
    runtimeProfile: "java25-node20", status: "READY",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 1800000).toISOString()
  });

  assert.ok(await workspaces.findByIdForUser(`ws-${suffix}-alice`, alice.id));
  assert.equal(await workspaces.findByIdForUser(`ws-${suffix}-alice`, bob.id), undefined);
  const expired = await workspaces.listExpiredReady(now.toISOString());
  assert.ok(expired.some((workspace) => workspace.id === `ws-${suffix}-alice`));
  assert.ok(!expired.some((workspace) => workspace.id === `ws-${suffix}-bob`));

  console.log("PostgreSQL persistence smoke: PASS");
  console.log(`user isolation => ${alice.id} != ${bob.id}`);
  console.log("execution account refs persisted without credential material");
  console.log("workspace ownership + expiry query => PASS");
} finally {
  if (createdUsers.length > 0) {
    await pool.query("delete from app_user where id = any($1::text[])", [createdUsers]).catch(() => undefined);
  }
  await pool.end();
}
