import assert from "node:assert/strict";
import test from "node:test";

import { handleHealthRequest } from "../src/http/health.js";

test("GET /health is unauthenticated liveness and does not touch the database", async () => {
  let databaseChecks = 0;
  const response = await handleHealthRequest(new Request("https://workspace.example/health"), {
    version: "0.1.0-dev.15",
    checkDatabase: async () => { databaseChecks += 1; }
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(databaseChecks, 0);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "agent-workspace",
    version: "0.1.0-dev.15"
  });
});

test("GET /ready reports PostgreSQL readiness", async () => {
  const response = await handleHealthRequest(new Request("https://workspace.example/ready"), {
    version: "test",
    checkDatabase: async () => undefined
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { database?: string };
  assert.equal(body.database, "ok");
});

test("GET /ready returns 503 when PostgreSQL is unavailable", async () => {
  const response = await handleHealthRequest(new Request("https://workspace.example/ready"), {
    version: "test",
    checkDatabase: async () => { throw new Error("db down"); }
  });

  assert.ok(response);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "unavailable",
    service: "agent-workspace",
    version: "test",
    database: "unavailable"
  });
});

test("non-health route is not intercepted", async () => {
  const response = await handleHealthRequest(new Request("https://workspace.example/mcp"), {
    version: "test",
    checkDatabase: async () => undefined
  });
  assert.equal(response, undefined);
});
