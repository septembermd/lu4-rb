import type {
  Boss,
  Entitlements,
  Member,
  Observation,
} from "../domain/model.ts";
// Synthetic fixtures. Never import these into the production catalogue.
export const demoBosses: Boss[] = [
  {
    id: 1,
    name: "Учебный босс · Север",
    level: 65,
    location: "Северная точка",
    respawnMinMinutes: 600,
    respawnMaxMinutes: 840,
    spawns: [{ x: 30, y: 25, z: null }],
    drops: [
      {
        itemId: 1,
        name: "Демонстрационный предмет",
        min: 1,
        max: 2,
        chancePercent: 12.5,
      },
    ],
    sourceUrl: "",
    verifiedAt: null,
  },
  {
    id: 2,
    name: "Учебный босс · Долина",
    level: 55,
    location: "Восточная точка",
    respawnMinMinutes: 480,
    respawnMaxMinutes: 720,
    spawns: [{ x: 70, y: 55, z: null }],
    drops: [],
    sourceUrl: "",
    verifiedAt: null,
  },
  {
    id: 3,
    name: "Учебный босс · Берег",
    level: 45,
    location: "Южная точка",
    respawnMinMinutes: null,
    respawnMaxMinutes: null,
    spawns: [{ x: 38, y: 80, z: null }],
    drops: [],
    sourceUrl: "",
    verifiedAt: null,
  },
];
export const demoMember: Member = {
  userId: "demo-user",
  clanId: "demo-clan",
  active: true,
  capabilities: [
    "view",
    "record_kill",
    "manage_agents",
    "manage_members",
    "manage_billing",
  ],
};
export const demoRights: Entitlements = {
  clanId: "demo-clan",
  siteUntil: "2099-01-01T00:00:00Z",
  ownAgents: true,
  serviceGrants: [
    {
      serverId: "gamma",
      bossIds: null,
      agentIds: null,
      startsAt: "2020-01-01T00:00:00Z",
      until: "2099-01-01T00:00:00Z",
    },
  ],
};
export function demoObservations(now: number): Observation[] {
  return [
    {
      id: "demo-1",
      agentId: "service-1",
      ownerClanId: null,
      serverId: "gamma",
      bossId: 1,
      observedAt: new Date(now - 120_000).toISOString(),
      result: "alive",
    },
    {
      id: "demo-2",
      agentId: "clan-1",
      ownerClanId: "demo-clan",
      serverId: "gamma",
      bossId: 2,
      observedAt: new Date(now - 300_000).toISOString(),
      result: "not_found",
    },
    {
      id: "demo-3",
      agentId: "clan-1",
      ownerClanId: "demo-clan",
      serverId: "gamma",
      bossId: 3,
      observedAt: new Date(now - 1_800_000).toISOString(),
      result: "failed",
    },
  ];
}
