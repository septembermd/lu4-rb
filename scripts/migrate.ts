import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString)
  throw Error("MIGRATION_DATABASE_URL (migration owner) required");
const pool = new Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('lu4-rb-migrations'))");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set(
    (await client.query("SELECT name FROM schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );
  for (const name of (await readdir(new URL("../db/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (applied.has(name)) continue;
    const sql = await readFile(
      new URL(`../db/${name}`, import.meta.url),
      "utf8",
    );
    await client.query("BEGIN");
    try {
      await client.query(sql.replace(/^BEGIN;\s*|COMMIT;\s*$/gm, ""));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext('lu4-rb-migrations'))",
  );
  client.release();
  await pool.end();
}
