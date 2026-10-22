import { Pool } from "pg";
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw Error("MIGRATION_DATABASE_URL required");
const db = new Pool({ connectionString, max: 1 });
try {
  const roles = await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('lu4_api','rb_runtime')");
  if (roles.rows.length !== 2) throw Error("Required runtime roles are missing");
  await db.query("GRANT lu4_api TO rb_runtime");
  console.log("Runtime role access configured");
} finally {
  await db.end();
}
