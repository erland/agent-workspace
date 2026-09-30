import { Pool, type QueryResultRow } from "pg";

import type { SqlClient, SqlQueryResult } from "./sql-client.js";

export function createPostgresPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL persistence");
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });
}

export class PgSqlClient implements SqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query<QueryResultRow>(text, values ? [...values] : undefined);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }
}
