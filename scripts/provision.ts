// Local operator CLI. Receives non-secret configuration over stdin and writes
// generated bearer tokens only to a new owner-readable file, never to stdout.
import { Pool } from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hash } from "../server/api.ts";
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw Error("MIGRATION_DATABASE_URL required");
const output = process.env.CREDENTIAL_OUTPUT;
if (!output)
  throw Error("CREDENTIAL_OUTPUT required (ignored local credentials path)");
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 16384) throw Error("Input too large");
}
const config = JSON.parse(input);
if (!["clan", "agent"].includes(config.kind))
  throw Error("kind must be clan or agent");
const token = randomBytes(32).toString("base64url");
const pool = new Pool({ connectionString, max: 1 }),
  client = await pool.connect();
try {
  await client.query("BEGIN");
  let result;
  if (config.kind === "clan") {
    if (
      typeof config.name !== "string" ||
      !config.name.trim() ||
      typeof config.nickname !== "string" ||
      !config.nickname.trim()
    )
      throw Error("name and nickname required");
    const until = new Date(config.until);
    if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now())
      throw Error("Future subscription until required");
    const clanId = randomUUID(),
      userId = randomUUID();
    await client.query("INSERT INTO clans(id,name) VALUES($1,$2)", [
      clanId,
      config.name,
    ]);
    await client.query("INSERT INTO users VALUES($1,$2,$3)", [
      userId,
      `operator:${userId}`,
      config.nickname,
    ]);
    await client.query(
      "INSERT INTO memberships VALUES($1,$2,true,'{view,record_kill,manage_agents,manage_members,manage_billing}')",
      [clanId, userId],
    );
    if (config.operator === true) {
      await client.query("INSERT INTO operators(user_id) VALUES($1)", [userId]);
    }
    await client.query(
      "INSERT INTO subscriptions(clan_id,site_until,own_agents) VALUES($1,$2,$3)",
      [clanId, until.toISOString(), config.ownAgents === true],
    );
    const expiresAt = new Date(
      Math.min(until.getTime(), Date.now() + 7 * 86400_000),
    ).toISOString();
    await client.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [hash(token), userId, expiresAt],
    );
    result = { clanId, userId, expiresAt, sessionToken: token };
  } else {
    if (
      typeof config.name !== "string" ||
      !config.name.trim() ||
      typeof config.serverId !== "string" ||
      !Array.isArray(config.bossIds) ||
      !config.bossIds.length ||
      config.bossIds.some(
        (id: unknown) =>
          typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0,
      )
    )
      throw Error("name, serverId and positive bossIds required");
    if (
      config.ownerClanId !== null &&
      (typeof config.ownerClanId !== "string" || !config.ownerClanId)
    )
      throw Error("Explicit ownerClanId required; null means service fleet");
    const agentId = randomUUID();
    await client.query(
      "INSERT INTO agents(id,owner_clan_id,name,token_hash,server_id) VALUES($1,$2,$3,$4,$5)",
      [agentId, config.ownerClanId, config.name, hash(token), config.serverId],
    );
    for (const bossId of new Set(config.bossIds))
      await client.query("INSERT INTO agent_targets VALUES($1,$2)", [
        agentId,
        bossId,
      ]);
    result = { agentId, agentToken: token };
  }
  // Exclusive creation avoids overwriting an existing credential. A failed commit
  // leaves an inert token file; it never activates partially provisioned access.
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await client.query("COMMIT");
  console.log("Provisioned. Credentials written to CREDENTIAL_OUTPUT.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
