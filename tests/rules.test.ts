import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  createKill,
  latestObservation,
  respawnWindow,
  visibleObservations,
} from "../src/domain/rules.ts";
import { demoBosses, demoMember, demoRights } from "../src/data/demo.ts";
import type { Observation } from "../src/domain/model.ts";
const now = Date.parse("2026-10-18T12:00:00Z");
const row = (patch: Partial<Observation> = {}): Observation => ({
  id: "o",
  agentId: "s",
  ownerClanId: null,
  serverId: "gamma",
  bossId: 1,
  observedAt: "2026-10-18T11:59:00Z",
  result: "alive",
  ...patch,
});
test("other clan never leaks, even with a service grant", () => {
  assert.deepEqual(
    visibleObservations(
      demoMember,
      demoRights,
      [row({ ownerClanId: "competitor" })],
      "gamma",
      now,
    ),
    [],
  );
});
test("expired subscription and removed member lose access immediately", () => {
  assert.equal(
    can(
      demoMember,
      { ...demoRights, siteUntil: new Date(now).toISOString() },
      "view",
      now,
    ),
    false,
  );
  assert.equal(
    can({ ...demoMember, active: false }, demoRights, "view", now),
    false,
  );
});
test("service access is scoped by server, boss, agent and time", () => {
  const rights = {
    ...demoRights,
    serviceGrants: [
      {
        serverId: "gamma",
        bossIds: [1],
        agentIds: ["s"],
        startsAt: "2026-10-18T10:00:00Z",
        until: "2026-10-19T00:00:00Z",
      },
    ],
  };
  const rows = [
    row(),
    row({ id: "wrong-boss", bossId: 2 }),
    row({ id: "wrong-server", serverId: "black" }),
    row({ id: "wrong-agent", agentId: "x" }),
    row({ id: "historical", observedAt: "2026-10-17T12:00:00Z" }),
  ];
  assert.deepEqual(
    visibleObservations(demoMember, rights, rows, "gamma", now).map(
      (x) => x.id,
    ),
    ["o"],
  );
});
test("own observations survive removal of service add-on", () => {
  assert.equal(
    visibleObservations(
      demoMember,
      { ...demoRights, serviceGrants: [] },
      [row({ ownerClanId: demoMember.clanId }), row()],
      "gamma",
      now,
    ).length,
    1,
  );
});
test("kill author and tenant come from membership, not request", () => {
  const kill = createKill(
    { bossId: 1, serverId: "gamma", killedAt: "2026-10-18T01:00:00Z" },
    demoMember,
    demoRights,
    now,
  );
  assert.equal(kill.clanId, demoMember.clanId);
  assert.equal(kill.authorId, demoMember.userId);
  const window = respawnWindow(demoBosses[0], kill, now)!;
  assert.equal(window.start, Date.parse("2026-10-18T11:00:00Z"));
  assert.equal(window.end, Date.parse("2026-10-18T15:00:00Z"));
  assert.equal(window.phase, "window");
  assert.equal(
    respawnWindow(demoBosses[0], kill, window.end + 1)?.phase,
    "elapsed",
  );
});
test("future kill, missing permission and ambiguous local time are rejected", () => {
  for (const killedAt of ["2026-10-19T00:00:00Z", "2026-10-18T10:00:00"])
    assert.throws(() =>
      createKill(
        { bossId: 1, serverId: "gamma", killedAt },
        demoMember,
        demoRights,
        now,
      ),
    );
  assert.throws(() =>
    createKill(
      { bossId: 1, serverId: "gamma", killedAt: "2026-10-18T10:00:00Z" },
      { ...demoMember, capabilities: ["view"] },
      demoRights,
      now,
    ),
  );
});
test("observation does not create a respawn timer; failed check does not erase evidence", () => {
  assert.equal(respawnWindow(demoBosses[0], undefined, now), null);
  const status = latestObservation(
    [
      row(),
      row({
        id: "failed",
        result: "failed",
        observedAt: "2026-10-18T12:00:00Z",
      }),
    ],
    1,
    now,
  );
  assert.equal(status.latestAttempt?.result, "failed");
  assert.equal(status.confirmed?.result, "alive");
  assert.equal(status.stale, false);
  assert.equal(
    latestObservation([row({ observedAt: "2026-10-18T11:00:00Z" })], 1, now)
      .stale,
    true,
  );
});
