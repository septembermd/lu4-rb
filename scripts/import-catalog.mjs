import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { validateCatalog } from "./validate-catalog.mjs";
if (!process.env.MIGRATION_DATABASE_URL || !process.argv[2] || !process.argv[3])
  throw Error(
    "MIGRATION_DATABASE_URL and arguments: catalog.json serverId required",
  );
const data = JSON.parse(await readFile(process.argv[2], "utf8"));
validateCatalog(data);
const serverId = process.argv[3],
  pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
  client = await pool.connect();
try {
  await client.query("BEGIN");
  if (
    !(await client.query("SELECT 1 FROM servers WHERE id=$1", [serverId])).rows
      .length
  )
    throw Error("Unknown server");
  for (const b of data.bosses) {
    await client.query(
      `INSERT INTO bosses(id,name,level,location,source_url,verified_at) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,level=EXCLUDED.level,location=EXCLUDED.location,source_url=EXCLUDED.source_url,verified_at=EXCLUDED.verified_at`,
      [b.id, b.name, b.level, b.location, b.sourceUrl, b.verifiedAt],
    );
    await client.query(
      `INSERT INTO boss_rules VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(server_id,boss_id) DO UPDATE SET min_minutes=EXCLUDED.min_minutes,max_minutes=EXCLUDED.max_minutes,source_url=EXCLUDED.source_url,verified_at=EXCLUDED.verified_at`,
      [
        serverId,
        b.id,
        b.respawnMinMinutes,
        b.respawnMaxMinutes,
        b.sourceUrl,
        b.verifiedAt,
      ],
    );
    await client.query("DELETE FROM spawn_points WHERE boss_id=$1", [b.id]);
    for (const p of b.spawns)
      await client.query("INSERT INTO spawn_points VALUES($1,$2,$3,$4,$5,$6)", [
        randomUUID(),
        b.id,
        p.x,
        p.y,
        p.z,
        b.sourceUrl,
      ]);
    await client.query("DELETE FROM drops WHERE boss_id=$1", [b.id]);
    for (const d of b.drops)
      await client.query(
        "INSERT INTO drops(boss_id,item_id,name,quantity_min,quantity_max,chance_percent,source_url) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [b.id, d.itemId, d.name, d.min, d.max, d.chancePercent, b.sourceUrl],
      );
  }
  await client.query("COMMIT");
  console.log(`Imported ${data.bosses.length} bosses for ${serverId}`);
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
