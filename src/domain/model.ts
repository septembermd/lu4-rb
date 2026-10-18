export type ObservationResult = "alive" | "not_found" | "failed";
export interface Boss {
  id: number;
  name: string;
  level: number;
  location: string;
  respawnMinMinutes: number | null;
  respawnMaxMinutes: number | null;
  spawns: { x: number; y: number; z: number | null }[];
  drops: {
    itemId: number;
    name: string;
    min: number;
    max: number;
    chancePercent: number | null;
  }[];
  sourceUrl: string;
  verifiedAt: string | null;
}
export interface Kill {
  id: string;
  clanId: string;
  serverId: string;
  bossId: number;
  killedAt: string;
  recordedAt: string;
  authorId: string;
  version: number;
}
export interface Observation {
  id: string;
  agentId: string;
  ownerClanId: string | null;
  serverId: string;
  bossId: number;
  observedAt: string;
  result: ObservationResult;
}
export interface Entitlements {
  clanId: string;
  siteUntil: string;
  ownAgents: boolean;
  serviceGrants: {
    serverId: string;
    bossIds: number[] | null;
    agentIds: string[] | null;
    startsAt: string;
    until: string;
  }[];
}
export interface Member {
  userId: string;
  clanId: string;
  active: boolean;
  capabilities: (
    | "view"
    | "record_kill"
    | "manage_agents"
    | "manage_members"
    | "manage_billing"
  )[];
}
