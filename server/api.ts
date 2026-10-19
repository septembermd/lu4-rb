import { inventory, claim } from "./scouts.ts";
import { createHash, randomUUID } from "node:crypto";
import type { Database, Transactions } from "./db.ts";
import { timestamp } from "../src/domain/rules.ts";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const uuid = (value: unknown): string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : fail(400, "Invalid UUID");
function date(value: unknown): string {
  try {
    if (typeof value !== "string") throw Error();
    timestamp(value);
    return new Date(value).toISOString();
  } catch {
    return fail(400, "Expected timestamp with timezone");
  }
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail(400, "Expected positive integer");
}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail(400, "Unknown request field");
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "Expected application/json");
  const text = await request.text();
  if (Buffer.byteLength(text) > 16_384) fail(413, "Body too large");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    return fail(400, "Invalid JSON object");
  }
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
async function context(db: Database, request: Request, agent = false) {
  await db.query("SET LOCAL ROLE lu4_api");
  await db.query(
    "SELECT set_config('app.user_id','',true),set_config('app.clan_id','',true),set_config('app.agent_id','',true)",
  );
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) fail(401, "Authentication required");
  if (agent) {
    const row = (
      await db.query<{
        id: string;
        server_id: string;
        owner_clan_id: string | null;
      }>("SELECT * FROM authenticate_agent($1)", [hash(match[1])])
    ).rows[0];
    if (!row) fail(401, "Invalid or inactive agent");
    await db.query("SELECT set_config('app.agent_id',$1,true)", [row.id]);
    return row;
  }
  const row = (
    await db.query<{ id: string | null }>(
      "SELECT authenticate_user($1) AS id",
      [hash(match[1])],
    )
  ).rows[0];
  if (!row?.id) fail(401, "Invalid or expired session");
  await db.query("SELECT set_config('app.user_id',$1,true)", [row.id]);
  return { id: row.id };
}
async function clanContext(db: Database, clanId: string, capability: string) {
  const allowed = (
    await db.query<{ ok: boolean }>("SELECT can_access($1,$2) AS ok", [
      clanId,
      capability,
    ])
  ).rows[0]?.ok;
  if (!allowed) fail(403, "Clan access denied");
  await db.query("SELECT set_config('app.clan_id',$1,true)", [clanId]);
}
export function createApi(database: Transactions) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET")
        return json({ status: "ok" });
      return await database.transaction(async (db) => {
        if (
          url.pathname.startsWith("/api/agent/v1/scouts/") &&
          request.method === "POST"
        ) {
          const agent = await context(db, request, true);
          const b = await body(request);
          const action = url.pathname.split("/").at(-1);
          if (action === "inventory") {
            fields(b, ["accounts"]);
            try {
              await inventory(db, agent.id, b);
            } catch (e) {
              if ((e as { code?: string }).code) throw e;
              fail(400, "Invalid inventory");
            }
            return json({ ok: true });
          }
          if (action === "claim") {
            fields(b, ["clientId"]);
            if (
              typeof b.clientId !== "string" ||
              !/^[a-zA-Z0-9_-]{1,64}$/.test(b.clientId)
            )
              fail(400, "Invalid client");
            return json(await claim(db, agent.id, b.clientId));
          }
          if (action === "heartbeat") {
            fields(b, ["leaseId", "clientId"]);
            const leaseId = uuid(b.leaseId);
            if (typeof b.clientId !== "string") fail(400, "Client required");
            const lease = (
              await db.query(
                `UPDATE scout_leases SET expires_at=least(now()+interval '2 minutes',created_at+interval '10 minutes')
              WHERE id=$1 AND agent_id=$2 AND client_id=$3 AND finished_at IS NULL AND expires_at>now() AND created_at+interval '10 minutes'>now() RETURNING id,expires_at`,
                [leaseId, agent.id, b.clientId],
              )
            ).rows[0];
            if (!lease) fail(409, "Lease expired or completed");
            return json(lease);
          }
          if (action === "complete") {
            fields(b, ["leaseId"]);
            const leaseId = uuid(b.leaseId);
            const lease = (
              await db.query<{ character_id: string }>(
                "UPDATE scout_leases SET finished_at=now() WHERE id=$1 AND agent_id=$2 AND finished_at IS NULL AND expires_at>now() RETURNING character_id",
                [leaseId, agent.id],
              )
            ).rows[0];
            if (!lease) fail(409, "Lease expired or completed");
            return json({ ok: true });
          }
          fail(404, "Not found");
        }
        if (
          url.pathname === "/api/agent/v1/observations" &&
          request.method === "POST"
        ) {
          const agent = await context(db, request, true);
          const b = await body(request);
          fields(b, [
            "clientEventId",
            "leaseId",
            "clientId",
            "bossId",
            "observedAt",
            "result",
            "evidence",
            "failureCode",
          ]);
          const clientEventId = uuid(b.clientEventId),
            bossId = integer(b.bossId),
            observedAt = date(b.observedAt);
          const result = b.result;
          if (!["alive", "not_found", "failed"].includes(String(result)))
            fail(400, "Invalid observation result");
          const evidence = b.evidence as Record<string, unknown>;
          if (
            !evidence ||
            typeof evidence !== "object" ||
            Array.isArray(evidence)
          )
            fail(400, "Evidence required");
          fields(evidence, [
            "worldLoaded",
            "characterAlive",
            "atExpectedLocation",
            "spawnCoverageComplete",
          ]);
          if (Object.values(evidence).some((v) => typeof v !== "boolean"))
            fail(400, "Invalid evidence");
          if (
            result !== "failed" &&
            ["worldLoaded", "atExpectedLocation"].some(
              (key) => evidence[key] !== true,
            )
          )
            fail(400, "Successful check requires valid world and position");
          if (result === "not_found" && evidence.spawnCoverageComplete !== true)
            fail(400, "Incomplete spawn coverage");
          if (
            result === "failed" &&
            (typeof b.failureCode !== "string" ||
              !/^[a-z_]{1,64}$/.test(b.failureCode))
          )
            fail(400, "Failure code required");
          if (result !== "failed" && b.failureCode !== undefined)
            fail(400, "Unexpected failure code");
          const leaseId = b.leaseId === undefined ? null : uuid(b.leaseId);
          if (leaseId && (typeof b.clientId !== "string" || !b.clientId))
            fail(400, "Client required");
          if (!leaseId && b.clientId !== undefined) fail(400, "Lease required");
          const canonical = {
            ...(leaseId ? { leaseId, clientId: b.clientId } : {}),
            bossId,
            observedAt,
            result,
            failureCode: b.failureCode ?? null,
            evidence: {
              worldLoaded: evidence.worldLoaded ?? false,
              characterAlive: evidence.characterAlive ?? false,
              atExpectedLocation: evidence.atExpectedLocation ?? false,
              spawnCoverageComplete: evidence.spawnCoverageComplete ?? false,
            },
          };
          const fingerprint = hash(JSON.stringify(canonical));
          const previous = (
            await db.query<{ id: string; payload_hash: string }>(
              "SELECT id,payload_hash FROM observations WHERE agent_id=$1 AND client_event_id=$2",
              [agent.id, clientEventId],
            )
          ).rows[0];
          if (previous) {
            if (previous.payload_hash !== fingerprint)
              fail(409, "Event ID already used with another payload");
            return json({ id: previous.id, replayed: true });
          }
          if (leaseId) {
            const lease = (
              await db.query<{ created_at: string }>(
                `SELECT l.created_at FROM scout_leases l JOIN scout_characters c ON c.id=l.character_id
              WHERE l.id=$1 AND l.agent_id=$2 AND l.client_id=$3 AND l.boss_id=$4 AND l.finished_at IS NULL AND l.expires_at>now()
              AND c.name=l.character_name FOR UPDATE OF l`,
                [leaseId, agent.id, b.clientId, bossId],
              )
            ).rows[0];
            if (!lease)
              fail(409, "Lease expired or does not match observation");
            if (Date.parse(observedAt) < new Date(lease.created_at).getTime())
              fail(400, "Observation predates assignment");
          } else if (
            (
              await db.query("SELECT 1 FROM fleet_settings WHERE agent_id=$1", [
                agent.id,
              ])
            ).rows.length
          ) {
            fail(400, "Managed fleet observations require a lease");
          }
          const now = Date.now();
          if (
            Date.parse(observedAt) > now + 30_000 ||
            Date.parse(observedAt) < now - 24 * 3600_000
          )
            fail(400, "Observation outside delivery window");
          const assigned = (
            await db.query(
              "SELECT 1 FROM agent_targets WHERE agent_id=$1 AND boss_id=$2",
              [agent.id, bossId],
            )
          ).rows.length;
          if (!assigned) fail(403, "Boss not assigned to agent");
          const id = randomUUID();
          // The DB trigger derives owner/server from the authenticated agent.
          await db.query(
            `INSERT INTO observations(id,agent_id,server_id,boss_id,observed_at,result,failure_code,client_event_id,evidence,payload_hash,lease_id)
            VALUES($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              id,
              agent.id,
              bossId,
              observedAt,
              result,
              b.failureCode ?? null,
              clientEventId,
              JSON.stringify(canonical.evidence),
              fingerprint,
              leaseId,
            ],
          );
          if (leaseId) {
            await db.query(
              "UPDATE scout_leases SET finished_at=now() WHERE id=$1",
              [leaseId],
            );
            await db.query(
              "UPDATE scout_characters SET retry_at=CASE WHEN $2::boolean THEN now()+interval '30 seconds' ELSE NULL END WHERE id=(SELECT character_id FROM scout_leases WHERE id=$1)",
              [leaseId, result === "failed"],
            );
          }
          return json({ id, replayed: false }, 201);
        }
        const identity = await context(db, request);
        if (url.pathname === "/api/scouts" && request.method === "GET") {
          return json({
            agents: (
              await db.query(
                "SELECT id,name,server_id,owner_clan_id,last_seen_at FROM agents WHERE revoked_at IS NULL",
              )
            ).rows,
            accounts: (await db.query("SELECT * FROM scout_accounts")).rows,
            characters: (await db.query("SELECT * FROM scout_characters")).rows,
            settings: (await db.query("SELECT * FROM fleet_settings")).rows,
          });
        }
        const scoutRoute =
          /^\/api\/scouts\/(accounts|characters|fleets)\/([^/]+)$/.exec(
            url.pathname,
          );
        if (scoutRoute && request.method === "PATCH") {
          const id = uuid(scoutRoute[2]),
            b = await body(request),
            type = scoutRoute[1];
          const table =
            type === "accounts"
              ? "scout_accounts"
              : type === "characters"
                ? "scout_characters"
                : "agents";
          const fleet = (
            await db.query<{ agent_id: string }>(
              `SELECT ${type === "fleets" ? "id" : "agent_id"} AS agent_id FROM ${table} WHERE id=$1`,
              [id],
            )
          ).rows[0];
          if (
            !fleet ||
            !(
              await db.query<{ ok: boolean }>(
                "SELECT fleet_manager($1) AS ok",
                [fleet.agent_id],
              )
            ).rows[0]?.ok
          )
            fail(403, "Fleet access denied");
          if (type === "fleets") {
            fields(b, ["running", "timerClanId"]);
            if (typeof b.running !== "boolean") fail(400, "running required");
            const timer = b.timerClanId === null ? null : uuid(b.timerClanId);
            if (
              timer &&
              !(
                await db.query<{ ok: boolean }>(
                  "SELECT is_operator() OR can_access($1,'manage_agents') AS ok",
                  [timer],
                )
              ).rows[0]?.ok
            )
              fail(403, "Timer access denied");
            await db.query(
              "INSERT INTO fleet_settings(agent_id,running,timer_clan_id) VALUES($1,$2,$3) ON CONFLICT(agent_id) DO UPDATE SET running=excluded.running,timer_clan_id=excluded.timer_clan_id",
              [id, b.running, timer],
            );
          } else if (type === "accounts") {
            fields(b, ["enabled"]);
            if (typeof b.enabled !== "boolean") fail(400, "enabled required");
            await db.query("UPDATE scout_accounts SET enabled=$1 WHERE id=$2", [
              b.enabled,
              id,
            ]);
          } else {
            fields(b, ["enabled", "bossId", "x", "y", "z", "radius"]);
            if (
              typeof b.enabled !== "boolean" ||
              ![b.x, b.y, b.z].every(
                (v) => typeof v === "number" && Number.isSafeInteger(v),
              )
            )
              fail(400, "Position and enabled required");
            const bossId = integer(b.bossId),
              radius = integer(b.radius);
            await db.query(
              "UPDATE scout_characters SET enabled=$1,boss_id=$2,expected_x=$3,expected_y=$4,expected_z=$5,radius=$6 WHERE id=$7",
              [b.enabled, bossId, b.x, b.y, b.z, radius, id],
            );
          }
          return json({ ok: true });
        }
        if (url.pathname === "/api/me" && request.method === "GET") {
          return json({
            userId: identity.id,
            clans: (
              await db.query(
                "SELECT c.id,c.name,m.capabilities FROM clans c JOIN memberships m ON m.clan_id=c.id WHERE m.user_id=api_user()",
              )
            ).rows,
          });
        }
        const route =
          /^\/api\/clans\/([^/]+)\/(kills|observations|catalog)(?:\/([^/]+))?$/.exec(
            url.pathname,
          );
        if (!route) fail(404, "Not found");
        const clanId = uuid(route[1]),
          resource = route[2],
          id = route[3] ? uuid(route[3]) : null;
        await clanContext(
          db,
          clanId,
          request.method === "GET" ? "view" : "record_kill",
        );
        if (request.method === "GET") {
          const serverId = url.searchParams.get("server") ?? "gamma";
          if (resource === "kills")
            return json({
              items: (
                await db.query(
                  "SELECT * FROM kill_events WHERE clan_id=$1 AND server_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY killed_at DESC,id DESC LIMIT 200",
                  [clanId, serverId, id],
                )
              ).rows,
            });
          if (id) fail(404, "Not found");
          if (resource === "observations")
            return json({
              items: (
                await db.query(
                  "SELECT * FROM (SELECT DISTINCT ON (boss_id,result) id,agent_id,owner_clan_id,server_id,boss_id,observed_at,result,CASE WHEN owner_clan_id IS NOT NULL THEN failure_code ELSE NULL END AS failure_code FROM observations WHERE server_id=$1 AND observed_at<=now() AND (owner_clan_id IS NOT NULL OR result<>'failed') ORDER BY boss_id,result,observed_at DESC,id DESC) latest ORDER BY observed_at DESC,id DESC LIMIT 500",
                  [serverId],
                )
              ).rows,
            });
          return json({
            items: (
              await db.query(
                `SELECT b.*,r.min_minutes,r.max_minutes,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('x',p.x,'y',p.y,'z',p.z)),'[]') FROM spawn_points p WHERE p.boss_id=b.id) AS spawns,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',d.item_id,'name',d.name,'min',d.quantity_min,'max',d.quantity_max,'chancePercent',d.chance_percent)),'[]') FROM drops d WHERE d.boss_id=b.id) AS drops
            FROM bosses b JOIN boss_rules r ON r.boss_id=b.id WHERE r.server_id=$1 ORDER BY b.level DESC,b.id LIMIT 1000`,
                [serverId],
              )
            ).rows,
          });
        }
        if (resource !== "kills") fail(405, "Method not allowed");
        const b = await body(request);
        if (request.method === "POST" && !id) {
          fields(b, ["bossId", "serverId", "killedAt"]);
          const bossId = integer(b.bossId),
            killedAt = date(b.killedAt);
          if (Date.parse(killedAt) > Date.now())
            fail(400, "Kill time cannot be in the future");
          if (typeof b.serverId !== "string" || !b.serverId.trim())
            fail(400, "Server required");
          const exists = (
            await db.query(
              "SELECT 1 FROM boss_rules WHERE boss_id=$1 AND server_id=$2",
              [bossId, b.serverId],
            )
          ).rows.length;
          if (!exists) fail(400, "Boss not in server catalogue");
          const inserted = await db.query(
            "INSERT INTO kill_events(id,clan_id,server_id,boss_id,killed_at,author_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [randomUUID(), clanId, b.serverId, bossId, killedAt, identity.id],
          );
          return json(inserted.rows[0], 201);
        }
        if (id && (request.method === "PATCH" || request.method === "DELETE")) {
          fields(
            b,
            request.method === "PATCH"
              ? ["killedAt", "expectedVersion"]
              : ["expectedVersion"],
          );
          const version = integer(b.expectedVersion);
          const before = (
            await db.query<{ version: number; voided_at: string | null }>(
              "SELECT * FROM kill_events WHERE id=$1 AND clan_id=$2 FOR UPDATE",
              [id, clanId],
            )
          ).rows[0];
          if (!before) fail(404, "Kill not found");
          if (before.version !== version || before.voided_at)
            fail(409, "Kill changed; reload before editing");
          let updated;
          if (request.method === "PATCH") {
            const killedAt = date(b.killedAt);
            if (Date.parse(killedAt) > Date.now())
              fail(400, "Kill time cannot be in the future");
            updated = await db.query(
              "UPDATE kill_events SET killed_at=$1,version=version+1 WHERE id=$2 AND clan_id=$3 RETURNING *",
              [killedAt, id, clanId],
            );
          } else
            updated = await db.query(
              "UPDATE kill_events SET voided_at=now(),version=version+1 WHERE id=$1 AND clan_id=$2 RETURNING *",
              [id, clanId],
            );
          await db.query(
            "INSERT INTO kill_revisions(id,kill_id,clan_id,actor_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              id,
              clanId,
              identity.id,
              JSON.stringify(before),
              JSON.stringify(updated.rows[0]),
            ],
          );
          return json(updated.rows[0]);
        }
        return fail(405, "Method not allowed");
      });
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      const code = (error as { code?: string }).code;
      if (code === "23505")
        return json({ error: "Conflict; retry the same request" }, 409);
      if (code === "42501") return json({ error: "Access denied" }, 403);
      if (code === "23503" || code === "23514" || code === "22P02")
        return json({ error: "Invalid reference or value" }, 400);
      // Do not serialize SQL errors, tokens, request bodies or tenant data.
      console.error("API failure", code ?? "unknown");
      return json({ error: "Internal server error" }, 500);
    }
  };
}
