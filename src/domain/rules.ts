import type { Boss, Entitlements, Kill, Member, Observation } from "./model.ts";

export function timestamp(value: string): number {
  // Require an explicit timezone; never silently interpret server-local time.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error("Укажите часовой пояс");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Некорректная дата");
  return parsed;
}
export function can(
  member: Member,
  rights: Entitlements,
  capability: Member["capabilities"][number],
  now: number,
): boolean {
  return (
    member.active &&
    member.clanId === rights.clanId &&
    timestamp(rights.siteUntil) > now &&
    member.capabilities.includes(capability)
  );
}
export function visibleObservations(
  member: Member,
  rights: Entitlements,
  rows: Observation[],
  serverId: string,
  now: number,
): Observation[] {
  if (!can(member, rights, "view", now)) return [];
  return rows.filter(
    (row) =>
      row.serverId === serverId &&
      timestamp(row.observedAt) <= now &&
      (row.ownerClanId === rights.clanId ||
        (row.ownerClanId === null &&
          rights.serviceGrants.some(
            (grant) =>
              grant.serverId === serverId &&
              timestamp(grant.startsAt) <= now &&
              timestamp(grant.until) > now &&
              timestamp(row.observedAt) >= timestamp(grant.startsAt) &&
              (grant.bossIds === null || grant.bossIds.includes(row.bossId)) &&
              (grant.agentIds === null || grant.agentIds.includes(row.agentId)),
          ))),
  );
}
export function createKill(
  input: { bossId: number; serverId: string; killedAt: string },
  member: Member,
  rights: Entitlements,
  now: number,
): Kill {
  if (!can(member, rights, "record_kill", now))
    throw new Error("Нет права отмечать убийства");
  const time = timestamp(input.killedAt);
  if (time > now) throw new Error("Время убийства не может быть в будущем");
  if (
    !Number.isSafeInteger(input.bossId) ||
    input.bossId <= 0 ||
    !input.serverId.trim()
  )
    throw new Error("Не выбран босс или сервер");
  return {
    ...input,
    id: crypto.randomUUID(),
    clanId: member.clanId,
    authorId: member.userId,
    recordedAt: new Date(now).toISOString(),
    version: 1,
  };
}
export function respawnWindow(boss: Boss, kill: Kill | undefined, now: number) {
  if (
    !kill ||
    boss.respawnMinMinutes === null ||
    boss.respawnMaxMinutes === null
  )
    return null;
  if (
    kill.bossId !== boss.id ||
    boss.respawnMinMinutes < 0 ||
    boss.respawnMaxMinutes < boss.respawnMinMinutes
  )
    throw new Error("Некорректное правило респауна");
  const start = timestamp(kill.killedAt) + boss.respawnMinMinutes * 60_000;
  const end = timestamp(kill.killedAt) + boss.respawnMaxMinutes * 60_000;
  return {
    start,
    end,
    phase: now < start ? "waiting" : now <= end ? "window" : "elapsed",
  } as const;
}
export function latestObservation(
  rows: Observation[],
  bossId: number,
  now: number,
  ttlMinutes = 15,
) {
  const sorted = rows
    .filter((row) => row.bossId === bossId && timestamp(row.observedAt) <= now)
    .sort(
      (a, b) =>
        timestamp(b.observedAt) - timestamp(a.observedAt) ||
        a.id.localeCompare(b.id),
    );
  const latestAttempt = sorted[0];
  const confirmed = sorted.find((row) => row.result !== "failed");
  return {
    latestAttempt,
    confirmed,
    stale:
      !confirmed || now - timestamp(confirmed.observedAt) > ttlMinutes * 60_000,
  };
}
