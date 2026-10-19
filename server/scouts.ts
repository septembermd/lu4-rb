import { randomUUID } from "node:crypto";
import type { Database } from "./db.ts";

export async function inventory(
  db: Database,
  agentId: string,
  data: Record<string, unknown>,
) {
  const accounts = data.accounts;
  if (!Array.isArray(accounts) || accounts.length > 100)
    throw Error("Invalid inventory");
  const keys = new Set<string>();
  for (const account of accounts) {
    if (
      !account ||
      typeof account !== "object" ||
      Object.keys(account).some(
        (k) => !["key", "label", "characters"].includes(k),
      )
    )
      throw Error("Invalid account");
    for (const value of [account.key, account.label])
      if (typeof value !== "string" || !value.trim() || value.length > 128)
        throw Error("Invalid account label");
    if (keys.has(account.key)) throw Error("Duplicate account");
    keys.add(account.key);
    if (!Array.isArray(account.characters) || account.characters.length > 64)
      throw Error("Invalid characters");
    const row = (
      await db.query<{ id: string }>(
        `INSERT INTO scout_accounts(id,agent_id,local_key,label) VALUES($1,$2,$3,$4)
      ON CONFLICT(agent_id,local_key) DO UPDATE SET label=excluded.label,seen_at=now() RETURNING id`,
        [randomUUID(), agentId, account.key, account.label],
      )
    ).rows[0];
    const slots = new Set<number>();
    for (const c of account.characters) {
      if (
        !c ||
        Object.keys(c).some((k) => !["slot", "name"].includes(k)) ||
        !Number.isInteger(c.slot) ||
        c.slot < 0 ||
        c.slot > 63 ||
        typeof c.name !== "string" ||
        !c.name.trim() ||
        c.name.length > 128 ||
        slots.has(c.slot)
      )
        throw Error("Invalid character");
      slots.add(c.slot);
      // A different character in an existing slot must be configured again.
      await db.query(
        `INSERT INTO scout_characters(id,account_id,agent_id,slot,name) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(account_id,slot) DO UPDATE SET name=excluded.name,seen_at=now(),
        enabled=CASE WHEN scout_characters.name=excluded.name THEN scout_characters.enabled ELSE false END`,
        [randomUUID(), row.id, agentId, c.slot, c.name],
      );
    }
    await db.query(
      "UPDATE scout_characters SET enabled=false WHERE account_id=$1 AND NOT(slot=ANY($2::int[]))",
      [row.id, [...slots]],
    );
  }
  await db.query(
    "UPDATE scout_accounts SET enabled=false WHERE agent_id=$1 AND NOT(local_key=ANY($2::text[]))",
    [agentId, [...keys]],
  );
}

export async function claim(
  db: Database,
  agentId: string,
  clientId: string,
  accountKey?: string,
) {
  // Serialize all claims for this agent. Account and client unique indexes are an additional guard.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [agentId]);
  await db.query(
    "UPDATE scout_leases SET finished_at=now() WHERE agent_id=$1 AND finished_at IS NULL AND expires_at<=now()",
    [agentId],
  );
  const existing = (
    await db.query(
      "SELECT * FROM scout_leases WHERE agent_id=$1 AND client_id=$2 AND finished_at IS NULL",
      [agentId, clientId],
    )
  ).rows[0];
  if (existing)
    return { lease: existing, character: existing.assignment, replayed: true };
  const character = (
    await db.query<{
      id: string;
      account_id: string;
      boss_id: number;
      name: string;
    }>(
      `SELECT c.*,a.local_key AS account_key FROM scout_characters c JOIN scout_accounts a ON a.id=c.account_id
    WHERE c.agent_id=$1 AND ($2::text IS NULL OR a.local_key=$2) AND scout_due(c.agent_id,c.boss_id) AND c.enabled AND a.enabled AND (c.retry_at IS NULL OR c.retry_at<=now())
    AND EXISTS(SELECT 1 FROM agent_targets t WHERE t.agent_id=c.agent_id AND t.boss_id=c.boss_id)
    AND NOT EXISTS(SELECT 1 FROM scout_leases l WHERE l.account_id=c.account_id AND l.finished_at IS NULL)
    ORDER BY c.last_attempt_at NULLS FIRST,c.id LIMIT 1 FOR UPDATE OF c`,
      [agentId, accountKey ?? null],
    )
  ).rows[0];
  if (!character) return { lease: null };
  const lease = (
    await db.query(
      `INSERT INTO scout_leases(id,agent_id,account_id,character_id,client_id,expires_at,boss_id,character_name,assignment)
    VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes',$6,$7,$8) RETURNING *`,
      [
        randomUUID(),
        agentId,
        character.account_id,
        character.id,
        clientId,
        character.boss_id,
        character.name,
        JSON.stringify(character),
      ],
    )
  ).rows[0];
  await db.query(
    "UPDATE scout_characters SET last_attempt_at=now() WHERE id=$1",
    [character.id],
  );
  return { lease, character };
}
