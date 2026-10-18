import { readFileSync } from "node:fs";
export function validateCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.bosses))
    throw Error("Expected schemaVersion=1 and bosses array");
  const ids = new Set();
  const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
  const source = (value) => {
    const u = new URL(value);
    if (u.protocol !== "https:") throw Error("Source must use HTTPS");
  };
  for (const b of data.bosses) {
    if (!integer(b.id, 1) || ids.has(b.id))
      throw Error("Invalid or duplicate boss ID");
    ids.add(b.id);
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      typeof b.location !== "string" ||
      !integer(b.level, 1) ||
      b.level > 100
    )
      throw Error(`Invalid identity for ${b.id}`);
    source(b.sourceUrl);
    if (
      typeof b.verifiedAt !== "string" ||
      !Number.isFinite(Date.parse(b.verifiedAt)) ||
      !b.verifiedAt.endsWith("Z")
    )
      throw Error(`Missing UTC verification date for ${b.id}`);
    if (!(
      (b.respawnMinMinutes === null && b.respawnMaxMinutes === null) ||
      (integer(b.respawnMinMinutes) &&
        integer(b.respawnMaxMinutes) &&
        b.respawnMaxMinutes >= b.respawnMinMinutes)
    ))
      throw Error(`Invalid respawn for ${b.id}`);
    if (!Array.isArray(b.spawns) || !Array.isArray(b.drops))
      throw Error("Missing spawns/drops");
    for (const p of b.spawns)
      if (
        !Number.isSafeInteger(p.x) ||
        !Number.isSafeInteger(p.y) ||
        !(p.z === null || Number.isSafeInteger(p.z))
      )
        throw Error(`Invalid coordinates for ${b.id}`);
    for (const d of b.drops)
      if (
        !integer(d.itemId, 1) ||
        typeof d.name !== "string" ||
        !d.name.trim() ||
        !integer(d.min, 1) ||
        !integer(d.max, d.min) ||
        !(
          d.chancePercent === null ||
          (typeof d.chancePercent === "number" &&
            Number.isFinite(d.chancePercent) &&
            d.chancePercent >= 0 &&
            d.chancePercent <= 100)
        )
      )
        throw Error(`Invalid drop for ${b.id}`);
  }
  return data.bosses.length;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  try {
    if (!process.argv[2])
      throw Error("Usage: npm run validate:catalog -- path/to/catalog.json");
    console.log(
      `Valid bosses: ${validateCatalog(JSON.parse(readFileSync(process.argv[2], "utf8")))}`,
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
