import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PostgresExecutionAccountRepository,
  PostgresWorkspaceRepository
} from "../src/persistence/postgres/repositories.js";
import type { SqlClient, SqlQueryResult } from "../src/persistence/postgres/sql-client.js";

class FakeSqlClient implements SqlClient {
  calls: Array<{ text: string; values: readonly unknown[] }> = [];
  nextRows: unknown[] = [];

  async query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: this.nextRows as Row[], rowCount: this.nextRows.length };
  }
}

describe("PostgreSQL repositories", () => {
  it("scopes workspace lookup by workspace id and user id", async () => {
    const db = new FakeSqlClient();
    const repo = new PostgresWorkspaceRepository(db);
    await repo.findByIdForUser("ws-1", "user-2");

    assert.match(db.calls[0]?.text ?? "", /where id = \$1 and user_id = \$2/i);
    assert.deepEqual(db.calls[0]?.values, ["ws-1", "user-2"]);
  });

  it("persists credentialRef but never credential material", async () => {
    const db = new FakeSqlClient();
    const repo = new PostgresExecutionAccountRepository(db);
    await repo.upsert({
      id: "ea-1", userId: "user-1", provider: "modal", providerAccountId: "modal-user",
      credentialRef: "secret://modal/user-1", status: "CONNECTED",
      createdAt: "2026-09-29T18:00:00.000Z", updatedAt: "2026-09-29T18:00:00.000Z"
    });

    const call = db.calls[0];
    assert.ok(call);
    assert.match(call.text, /credential_ref/i);
    assert.ok(call.values.includes("secret://modal/user-1"));
    assert.ok(!call.text.toLowerCase().includes("refresh_token"));
    assert.ok(!call.text.toLowerCase().includes("client_secret"));
  });

  it("maps persisted workspace metadata including project JSON state", async () => {
    const db = new FakeSqlClient();
    db.nextRows = [{
      id: "ws-1", user_id: "user-1", provider_id: "modal", provider_workspace_id: "sb-1",
      runtime_profile: "java21-node22", status: "READY",
      created_at: "2026-09-29T18:00:00.000Z", expires_at: "2026-09-29T18:30:00.000Z",
      destroyed_at: null,
      project_json: JSON.stringify({ uploadedAt: "2026-09-29T18:01:00.000Z", analysis: { projectType: "NPM", projectRoots: [""], recommendedRuntime: { java: "21", node: "22" }, warnings: [] }, archive: { entryCount: 1, totalCompressedBytes: 10, totalUncompressedBytes: 10 } })
    }];
    const repo = new PostgresWorkspaceRepository(db);
    const workspace = await repo.findByIdForUser("ws-1", "user-1");

    assert.equal(workspace?.userId, "user-1");
    assert.equal(workspace?.project?.analysis.projectType, "NPM");
    assert.doesNotMatch(db.calls[0]?.text ?? "", /prototype_json/i);
  });

  it("does not persist obsolete prototype workspace state", async () => {
    const db = new FakeSqlClient();
    const repo = new PostgresWorkspaceRepository(db);
    await repo.upsert({
      id: "ws-2",
      userId: "user-1",
      runtimeProfile: "java21-node22",
      status: "READY",
      createdAt: "2026-10-07T00:00:00.000Z",
      expiresAt: "2026-10-07T01:00:00.000Z"
    });

    assert.doesNotMatch(db.calls[0]?.text ?? "", /prototype_json/i);
  });
});
