import { timestamp } from "./rules.ts";

/** Configuration contains aliases only, never account passwords. */
export interface ScoutCharacter {
  id: string;
  accountId: string;
  serverId: string;
  ownerClanId: string | null;
  slot: number;
  enabled: boolean;
  accountEnabled: boolean;
  bossId: number | null;
  lastAttemptAt: string | null;
  retryAt: string | null;
}
export interface QueueKill {
  clanId: string;
  serverId: string;
  bossId: number;
  killedAt: string;
  voided: boolean;
}
export interface QueueRule {
  serverId: string;
  bossId: number;
  minMinutes: number | null;
}
export interface ActiveLease {
  accountId: string;
  clientId: string;
  expiresAt: string;
}
/** Pure scheduling decision. The eventual DB claim must lock and recheck atomically. */
export function planChecks(input: {
  characters: ScoutCharacter[];
  kills: QueueKill[];
  rules: QueueRule[];
  leases: ActiveLease[];
  ownerClanId: string | null;
  timerClanId: string;
  serverId: string;
  clientId: string;
  now: number;
}) {
  const { now } = input;
  if (input.ownerClanId !== null && input.timerClanId !== input.ownerClanId)
    throw Error("Clan fleet can only use its own timers");
  const active = input.leases.filter((l) => timestamp(l.expiresAt) > now);
  const clientBusy = active.some((l) => l.clientId === input.clientId);
  return input.characters
    .filter(
      (c) =>
        c.ownerClanId === input.ownerClanId && c.serverId === input.serverId,
    )
    .map((c) => {
      let reason:
        "disabled" | "unassigned" | "busy" | "retry" | "respawn" | "ready" =
        "ready";
      let nextAt: number | null = null;
      if (!c.enabled || !c.accountEnabled) reason = "disabled";
      else if (c.bossId === null) reason = "unassigned";
      else if (clientBusy || active.some((l) => l.accountId === c.accountId))
        reason = "busy";
      else {
        const rule = input.rules.find(
          (r) => r.serverId === c.serverId && r.bossId === c.bossId,
        );
        const kill = input.kills
          .filter(
            (k) =>
              !k.voided &&
              k.clanId === input.timerClanId &&
              k.serverId === c.serverId &&
              k.bossId === c.bossId &&
              timestamp(k.killedAt) <= now,
          )
          .sort((a, b) => timestamp(b.killedAt) - timestamp(a.killedAt))[0];
        const start =
          kill && rule?.minMinutes != null && rule.minMinutes >= 0
            ? timestamp(kill.killedAt) + rule.minMinutes * 60_000
            : now;
        const retry = c.retryAt ? timestamp(c.retryAt) : now;
        if (Math.max(start, retry) > now) {
          nextAt = Math.max(start, retry);
          reason = retry >= start ? "retry" : "respawn";
        }
      }
      return { character: c, reason, nextAt };
    })
    .sort((a, b) => {
      const rank = (r: string) => (r === "ready" ? 0 : 1);
      return (
        rank(a.reason) - rank(b.reason) ||
        (a.character.lastAttemptAt
          ? timestamp(a.character.lastAttemptAt)
          : -Infinity) -
          (b.character.lastAttemptAt
            ? timestamp(b.character.lastAttemptAt)
            : -Infinity) ||
        a.character.id.localeCompare(b.character.id)
      );
    });
}
