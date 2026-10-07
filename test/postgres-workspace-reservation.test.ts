import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PersistedWorkspace } from "../src/persistence/models.js";
import { PostgresWorkspaceRepository } from "../src/persistence/postgres/repositories.js";
import type { SqlClient, SqlQueryResult } from "../src/persistence/postgres/sql-client.js";

class RecordingSqlClient implements SqlClient {
  public text = "";
  public values: readonly unknown[] = [];

  constructor(private readonly result: SqlQueryResult<any>) {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<Row>> {
    this.text = text;
    this.values = values;
    return this.result as SqlQueryResult<Row>;
  }
}

function workspace(status: PersistedWorkspace["status"] = "CREATING"): PersistedWorkspace {
  return {
    id: "ws-1",
    userId: "user-1",
    runtimeProfile: "java21-node22",
    status,
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:30:00.000Z"
  };
}

describe("PostgresWorkspaceRepository quota reservation", () => {
  it("serializes per-user reservations and counts CREATING plus READY", async () => {
    const db = new RecordingSqlClient({ rows: [{ id: "ws-1" }] });
    const repository = new PostgresWorkspaceRepository(db);

    assert.equal(await repository.reserveWorkspace(workspace(), 3), true);
    assert.match(db.text, /pg_advisory_xact_lock/);
    assert.match(db.text, /hashtextextended\(\$1, 0\)/);
    assert.match(db.text, /status in \('CREATING','READY'\)/);
    assert.match(db.text, /select \$2,\$1,null,null/);
    assert.match(db.text, /active\.count < \$9/);
    assert.equal(db.values[0], "user-1");
    assert.equal(db.values[8], 3);
  });

  it("returns false when the atomic insert did not reserve capacity", async () => {
    const db = new RecordingSqlClient({ rows: [] });
    const repository = new PostgresWorkspaceRepository(db);

    assert.equal(await repository.reserveWorkspace(workspace(), 1), false);
  });

  it("deletes only unallocated CREATING reservations", async () => {
    const db = new RecordingSqlClient({ rows: [] });
    const repository = new PostgresWorkspaceRepository(db);

    await repository.deleteReservation("ws-1", "user-1");
    assert.match(db.text, /status = 'CREATING'/);
    assert.match(db.text, /provider_id is null/);
    assert.match(db.text, /provider_workspace_id is null/);
    assert.deepEqual(db.values, ["ws-1", "user-1"]);
  });

  it("selects expired CREATING and READY workspaces for cleanup", async () => {
    const db = new RecordingSqlClient({ rows: [] });
    const repository = new PostgresWorkspaceRepository(db);

    await repository.listExpiredActive("2026-10-01T01:00:00.000Z", 10);
    assert.match(db.text, /status in \('CREATING','READY'\)/);
  });
});
