import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool } from "pg";

const LOCK_ID = 2_147_417_015;

export async function runMigrations(options: {
  databaseUrl?: string;
  migrationsDir?: string;
} = {}): Promise<void> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      create table if not exists schema_migration (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const alreadyApplied = await client.query(
        "select 1 from schema_migration where name = $1",
        [name]
      );
      if ((alreadyApplied.rowCount ?? 0) > 0) continue;

      const sql = await readFile(join(migrationsDir, name), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migration(name) values ($1)", [name]);
        await client.query("commit");
        process.stderr.write(`Applied migration ${name}\n`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

function defaultMigrationsDir(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "../../../db/migrations");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMigrations();
}
