import test from "node:test";
import assert from "node:assert/strict";
import { planChecks, type ScoutCharacter } from "../src/domain/queue.ts";
const now = Date.parse("2026-10-19T10:00:00Z");
const character: ScoutCharacter = {
  id: "one",
  accountId: "account",
  serverId: "gamma",
  ownerClanId: "clan",
  slot: 0,
  enabled: true,
  accountEnabled: true,
  bossId: 1,
  lastAttemptAt: null,
  retryAt: null,
};
const base = {
  characters: [character],
  kills: [],
  rules: [],
  leases: [],
  ownerClanId: "clan",
  timerClanId: "clan",
  serverId: "gamma",
  clientId: "client",
  now,
};
test("unknown timers check continuously; unrelated and voided kills cannot pause scouts", () => {
  assert.equal(planChecks(base)[0].reason, "ready");
  for (const kill of [
    { clanId: "other", voided: false },
    { clanId: "clan", voided: true },
  ]) {
    assert.equal(
      planChecks({
        ...base,
        rules: [{ serverId: "gamma", bossId: 1, minMinutes: 120 }],
        kills: [
          {
            ...kill,
            serverId: "gamma",
            bossId: 1,
            killedAt: "2026-10-19T09:00:00Z",
          },
        ],
      })[0].reason,
      "ready",
    );
  }
});
test("earliest respawn pauses checks, boundary resumes; correcting or cancelling recalculates", () => {
  const input = {
    ...base,
    rules: [{ serverId: "gamma", bossId: 1, minMinutes: 120 }],
    kills: [
      {
        clanId: "clan",
        voided: false,
        serverId: "gamma",
        bossId: 1,
        killedAt: "2026-10-19T09:00:00Z",
      },
    ],
  };
  assert.equal(planChecks(input)[0].reason, "respawn");
  assert.equal(planChecks({ ...input, now: now + 3600000 })[0].reason, "ready");
  assert.equal(planChecks({ ...input, kills: [] })[0].reason, "ready");
  assert.throws(() => planChecks({ ...base, timerClanId: "other" }));
});
test("active lease blocks same account across clients and same client across accounts; expiry releases", () => {
  for (const lease of [
    { accountId: "account", clientId: "other" },
    { accountId: "other", clientId: "client" },
  ]) {
    assert.equal(
      planChecks({
        ...base,
        leases: [{ ...lease, expiresAt: "2026-10-19T10:01:00Z" }],
      })[0].reason,
      "busy",
    );
    assert.equal(
      planChecks({
        ...base,
        leases: [{ ...lease, expiresAt: "2026-10-19T10:00:00Z" }],
      })[0].reason,
      "ready",
    );
  }
});
test("round robin uses last attempt including failures; disabled and unassigned excluded", () => {
  const rows = planChecks({
    ...base,
    characters: [
      { ...character, id: "recent", lastAttemptAt: "2026-10-19T09:59:00Z" },
      { ...character, id: "never" },
      { ...character, id: "disabled", enabled: false },
      { ...character, id: "unset", bossId: null },
    ],
  });
  assert.equal(rows[0].character.id, "never");
  assert.equal(rows[1].character.id, "recent");
  assert.equal(
    rows.find((r) => r.character.id === "disabled")?.reason,
    "disabled",
  );
  assert.equal(
    rows.find((r) => r.character.id === "unset")?.reason,
    "unassigned",
  );
});
