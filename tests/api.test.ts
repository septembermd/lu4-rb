import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApi, hash } from "../server/api.ts";
import type { Database } from "../server/db.ts";
const pg = new PGlite();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "userA".repeat(8),
  tokenB = "userB".repeat(8),
  agentToken = "agentA".repeat(8),
  serviceToken = "service".repeat(8);
const a = id(1),
  b = id(2),
  u = id(3),
  v = id(4),
  agent = id(5),
  service = id(6);
const api = createApi({
  transaction: (run) => pg.transaction((tx) => run(tx as Database)),
});
async function call(
  path: string,
  method = "GET",
  payload?: unknown,
  bearer = token,
) {
  const res = await api(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: res.status, body: await res.json() };
}
const path = `/api/clans/${a}`;
const iso = (delta = 0) => new Date(Date.now() + delta).toISOString();
let killId: string;
before(async () => {
  for (const file of [
    "001_initial.sql",
    "002_api.sql",
    "003_scout_registry.sql",
  ])
    await pg.exec(
      await readFile(new URL(`../db/${file}`, import.meta.url), "utf8"),
    );
  await pg.query("INSERT INTO clans(id,name) VALUES($1,$2),($3,$4)", [
    a,
    "Alpha",
    b,
    "Beta",
  ]);
  await pg.query("INSERT INTO users VALUES($1,$2,$3),($4,$5,$6)", [
    u,
    "test-a",
    "A",
    v,
    "test-b",
    "B",
  ]);
  await pg.query(
    "INSERT INTO memberships VALUES($1,$2,true,'{view,record_kill}'),($3,$4,true,'{view,record_kill}')",
    [a, u, b, v],
  );
  await pg.query(
    "INSERT INTO subscriptions(clan_id,site_until,own_agents) VALUES($1,now()+interval '1 day',true),($2,now()+interval '1 day',true)",
    [a, b],
  );
  await pg.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '1 day',NULL),($3,$4,now()+interval '1 day',NULL)",
    [hash(token), u, hash(tokenB), v],
  );
  await pg.query(
    "INSERT INTO bosses(id,name,level,location,source_url,verified_at) VALUES(1,'Test',60,'Fixture','https://example.org',now()),(2,'Other',65,'Fixture','https://example.org',now())",
  );
  await pg.query(
    "INSERT INTO boss_rules VALUES('gamma',1,600,840,'https://example.org',now())",
  );
  await pg.query(
    "INSERT INTO agents(id,owner_clan_id,name,token_hash,server_id) VALUES($1,$2,'Own',$3,'gamma'),($4,NULL,'Service',$5,'gamma')",
    [agent, a, hash(agentToken), service, hash(serviceToken)],
  );
  await pg.query("INSERT INTO agent_targets VALUES($1,1),($2,1)", [
    agent,
    service,
  ]);
});
after(() => pg.close());
test("unauthenticated access and crossing clan boundary denied", async () => {
  assert.equal(
    (await call(`${path}/kills`, "GET", undefined, "wrong")).status,
    401,
  );
  assert.equal((await call(`/api/clans/${b}/kills`)).status, 403);
  assert.equal(
    (await call(`${path}/kills`, "GET", undefined, agentToken)).status,
    401,
  );
});
test("create, versioned correction, audit and logical cancellation persist", async () => {
  const created = await call(`${path}/kills`, "POST", {
    bossId: 1,
    serverId: "gamma",
    killedAt: iso(-3600_000),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  killId = created.body.id;
  assert.equal(created.body.author_id, u);
  const modified = await call(`${path}/kills/${killId}`, "PATCH", {
    expectedVersion: 1,
    killedAt: iso(-1800_000),
  });
  assert.equal(modified.status, 200);
  assert.equal(modified.body.version, 2);
  assert.equal(
    (
      await call(`${path}/kills/${killId}`, "PATCH", {
        expectedVersion: 1,
        killedAt: iso(-1000),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        `/api/clans/${b}/kills/${killId}`,
        "PATCH",
        { expectedVersion: 2, killedAt: iso(-1000) },
        tokenB,
      )
    ).status,
    404,
  );
  const cancelled = await call(`${path}/kills/${killId}`, "DELETE", {
    expectedVersion: 2,
  });
  assert.equal(cancelled.status, 200);
  assert.ok(cancelled.body.voided_at);
  assert.equal(
    (await pg.query("SELECT * FROM kill_revisions WHERE kill_id=$1", [killId]))
      .rows.length,
    2,
  );
  assert.equal((await call(`${path}/kills`)).body.items.length, 1);
});
test("future dates and identity injection rejected", async () => {
  for (const payload of [
    { bossId: 1, serverId: "gamma", killedAt: iso(3600_000) },
    { bossId: 1, serverId: "gamma", killedAt: iso(-1000), clanId: b },
  ])
    assert.equal((await call(`${path}/kills`, "POST", payload)).status, 400);
});
let eventId = id(10),
  event: any;
test("agent ingestion requires valid evidence and assigned boss; derives ownership", async () => {
  event = {
    clientEventId: eventId,
    bossId: 1,
    observedAt: iso(-1000),
    result: "not_found",
    evidence: {
      worldLoaded: true,
      characterAlive: true,
      atExpectedLocation: true,
      spawnCoverageComplete: true,
    },
  };
  assert.equal(
    (
      await call(
        "/api/agent/v1/observations",
        "POST",
        { ...event, evidence: { ...event.evidence, worldLoaded: false } },
        agentToken,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/agent/v1/observations",
        "POST",
        { ...event, bossId: 2 },
        agentToken,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/agent/v1/observations",
        "POST",
        { ...event, ownerClanId: b },
        agentToken,
      )
    ).status,
    400,
  );
  const response = await call(
    "/api/agent/v1/observations",
    "POST",
    event,
    agentToken,
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(
    (await call("/api/agent/v1/observations", "POST", event, agentToken)).body
      .replayed,
    true,
  );
  assert.equal(
    (
      await call(
        "/api/agent/v1/observations",
        "POST",
        { ...event, result: "alive" },
        agentToken,
      )
    ).status,
    409,
  );
  const observations = (await call(`${path}/observations`)).body.items;
  assert.equal(observations.length, 1);
  assert.equal(observations[0].owner_clan_id, a);
  assert.equal(
    (await call(`/api/clans/${b}/observations`, "GET", undefined, tokenB)).body
      .items.length,
    0,
  );
  assert.equal(
    (await pg.query("SELECT * FROM kill_events")).rows.length,
    1,
    "observations must not create kills",
  );
});
test("service results require active matching grants, expiry takes effect immediately", async () => {
  assert.equal(
    (
      await call(
        "/api/agent/v1/observations",
        "POST",
        { ...event, clientEventId: id(11), result: "alive" },
        serviceToken,
      )
    ).status,
    201,
  );
  assert.equal((await call(`${path}/observations`)).body.items.length, 1);
  await pg.query(
    "INSERT INTO service_grants VALUES($1,$2,'gamma',ARRAY[1],ARRAY[$3::uuid],now()-interval '1 hour',now()+interval '1 hour')",
    [id(12), a, service],
  );
  assert.equal((await call(`${path}/observations`)).body.items.length, 2);
  await pg.query("UPDATE service_grants SET boss_ids=ARRAY[2] WHERE id=$1", [
    id(12),
  ]);
  assert.equal((await call(`${path}/observations`)).body.items.length, 1);
  await pg.query(
    "UPDATE service_grants SET boss_ids=ARRAY[1],until_at=now()-interval '1 minute' WHERE id=$1",
    [id(12)],
  );
  assert.equal((await call(`${path}/observations`)).body.items.length, 1);
});
test("dead scouts remain valid and service failures are hidden from subscribers", async () => {
  const dead = {
    ...event,
    clientEventId: id(30),
    evidence: { ...event.evidence, characterAlive: false },
  };
  assert.equal(
    (await call("/api/agent/v1/observations", "POST", dead, agentToken)).status,
    201,
  );
  await pg.query(
    "UPDATE service_grants SET boss_ids=ARRAY[1],until_at=now()+interval '1 hour' WHERE id=$1",
    [id(12)],
  );
  const failed = {
    ...event,
    clientEventId: id(31),
    result: "failed",
    failureCode: "login_failed",
  };
  assert.equal(
    (await call("/api/agent/v1/observations", "POST", failed, serviceToken))
      .status,
    201,
  );
  const rows = (await call(`${path}/observations`)).body.items;
  assert.ok(
    rows.some((r: any) => r.owner_clan_id === null && r.result === "alive"),
  );
  assert.ok(
    !rows.some((r: any) => r.owner_clan_id === null && r.result === "failed"),
  );
});
test("RLS filters rows even if SQL forgets explicit clan filter", async () => {
  await pg.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE lu4_api");
    await tx.query(
      "SELECT set_config('app.user_id',$1,true),set_config('app.clan_id',$2,true)",
      [v, b],
    );
    assert.equal((await tx.query("SELECT * FROM kill_events")).rows.length, 0);
    assert.equal(
      (await tx.query("SELECT * FROM kill_revisions")).rows.length,
      0,
    );
    assert.equal((await tx.query("SELECT * FROM observations")).rows.length, 0);
  });
});
test("scout inventory, private management, leases and respawn scheduling", async () => {
  await pg.query("INSERT INTO operators VALUES($1)", [u]);
  const endpoint = "/api/agent/v1/scouts/";
  const report = {
    accounts: [
      {
        key: "account-one",
        label: "Account one",
        characters: [{ slot: 0, name: "Scout" }],
      },
    ],
  };
  assert.equal(
    (await call(endpoint + "inventory", "POST", report, agentToken)).status,
    200,
  );
  let registry = (await call("/api/scouts")).body;
  const account = registry.accounts[0],
    character = registry.characters[0];
  assert.equal(account.enabled, false);
  assert.equal(
    (await call("/api/scouts", "GET", undefined, tokenB)).body.accounts.length,
    0,
  );
  assert.equal(
    (
      await call(
        `/api/scouts/accounts/${account.id}`,
        "PATCH",
        { enabled: true },
        tokenB,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/scouts/accounts/${account.id}`, "PATCH", {
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/scouts/characters/${character.id}`, "PATCH", {
        enabled: true,
        bossId: 1,
        x: 1,
        y: 2,
        z: 3,
        radius: 500,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/scouts/fleets/${agent}`, "PATCH", {
        running: true,
        timerClanId: a,
      })
    ).status,
    200,
  );
  const first = await call(
    endpoint + "claim",
    "POST",
    { clientId: "one" },
    agentToken,
  );
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.lease);
  assert.equal(
    (await call(endpoint + "claim", "POST", { clientId: "two" }, agentToken))
      .body.lease,
    null,
  );
  assert.equal(
    (await call(endpoint + "claim", "POST", { clientId: "one" }, agentToken))
      .body.lease.id,
    first.body.lease.id,
  );
  await pg.query(
    "UPDATE scout_leases SET expires_at=now()-interval '1 second'",
  );
  const next = await call(
    endpoint + "claim",
    "POST",
    { clientId: "two" },
    agentToken,
  );
  assert.ok(next.body.lease);
  assert.equal(
    (
      await call(
        endpoint + "complete",
        "POST",
        { leaseId: first.body.lease.id },
        agentToken,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        endpoint + "complete",
        "POST",
        { leaseId: next.body.lease.id },
        agentToken,
      )
    ).status,
    200,
  );
  const kill = await call(`${path}/kills`, "POST", {
    bossId: 1,
    serverId: "gamma",
    killedAt: iso(-1000),
  });
  assert.equal(
    (await call(endpoint + "claim", "POST", { clientId: "one" }, agentToken))
      .body.lease,
    null,
  );
  await call(`${path}/kills/${kill.body.id}`, "DELETE", { expectedVersion: 1 });
  report.accounts[0].characters[0].name = "Replacement";
  await call(endpoint + "inventory", "POST", report, agentToken);
  registry = (await call("/api/scouts")).body;
  assert.equal(registry.characters[0].enabled, false);
  await pg.query("DELETE FROM operators WHERE user_id=$1", [u]);
});
test("revoked membership, session and expired subscription stop access", async () => {
  await pg.query("UPDATE memberships SET active=false WHERE clan_id=$1", [a]);
  assert.equal((await call(`${path}/kills`)).status, 403);
  await pg.query("UPDATE memberships SET active=true WHERE clan_id=$1", [a]);
  await pg.query(
    "UPDATE subscriptions SET site_until=now()-interval '1 second' WHERE clan_id=$1",
    [a],
  );
  assert.equal((await call(`${path}/kills`)).status, 403);
  assert.equal(
    (await call("/api/agent/v1/observations", "POST", event, agentToken))
      .status,
    401,
  );
  await pg.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [v]);
  assert.equal(
    (await call(`/api/clans/${b}/kills`, "GET", undefined, tokenB)).status,
    401,
  );
});
