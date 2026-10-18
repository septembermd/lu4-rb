-- Foundation migration. Apply with a migration owner, never the runtime role.
BEGIN;
CREATE TABLE clans (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY, external_subject text NOT NULL UNIQUE, nickname text NOT NULL);
CREATE TABLE memberships (
  clan_id uuid NOT NULL REFERENCES clans, user_id uuid NOT NULL REFERENCES users,
  active boolean NOT NULL DEFAULT true, capabilities text[] NOT NULL DEFAULT '{view}',
  PRIMARY KEY (clan_id,user_id),
  CHECK (capabilities <@ ARRAY['view','record_kill','manage_agents','manage_members','manage_billing']::text[])
);
CREATE TABLE servers (id text PRIMARY KEY, name text NOT NULL);
INSERT INTO servers VALUES ('gamma','Gamma');
CREATE TABLE bosses (
  id integer PRIMARY KEY CHECK (id>0), name text NOT NULL, level integer NOT NULL CHECK(level BETWEEN 1 AND 100),
  location text NOT NULL, source_url text NOT NULL, verified_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE spawn_points (
  id uuid PRIMARY KEY, boss_id integer NOT NULL REFERENCES bosses,
  x integer NOT NULL, y integer NOT NULL, z integer,
  source_url text NOT NULL
);
CREATE TABLE boss_rules (
  server_id text NOT NULL REFERENCES servers, boss_id integer NOT NULL REFERENCES bosses,
  min_minutes integer, max_minutes integer, source_url text NOT NULL, verified_at timestamptz NOT NULL,
  PRIMARY KEY(server_id,boss_id),
  CHECK ((min_minutes IS NULL AND max_minutes IS NULL) OR (min_minutes IS NOT NULL AND max_minutes IS NOT NULL AND min_minutes>=0 AND max_minutes>=min_minutes))
);
CREATE TABLE drops (
  boss_id integer NOT NULL REFERENCES bosses, item_id integer NOT NULL, group_key text NOT NULL DEFAULT '',
  name text NOT NULL, quantity_min bigint NOT NULL CHECK(quantity_min>0), quantity_max bigint NOT NULL,
  chance_percent numeric CHECK(chance_percent BETWEEN 0 AND 100),
  source_url text NOT NULL, PRIMARY KEY(boss_id,item_id,group_key), CHECK(quantity_max>=quantity_min)
);
CREATE TABLE subscriptions (
  clan_id uuid PRIMARY KEY REFERENCES clans, site_until timestamptz NOT NULL,
  own_agents boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
-- NULL owner means operator service fleet. Operator identity and owner are distinct.
CREATE TABLE agents (
  id uuid PRIMARY KEY, owner_clan_id uuid REFERENCES clans, name text NOT NULL,
  token_hash text NOT NULL UNIQUE, revoked_at timestamptz,
  server_id text NOT NULL REFERENCES servers, last_seen_at timestamptz
);
CREATE TABLE service_grants (
  id uuid PRIMARY KEY, clan_id uuid NOT NULL REFERENCES clans, server_id text NOT NULL REFERENCES servers,
  boss_ids integer[], agent_ids uuid[], starts_at timestamptz NOT NULL, until_at timestamptz NOT NULL,
  CHECK(until_at>starts_at)
);
CREATE TABLE observations (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agents,
  server_id text NOT NULL REFERENCES servers, boss_id integer NOT NULL REFERENCES bosses,
  observed_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK(result IN ('alive','not_found','failed')),
  failure_code text, client_event_id uuid NOT NULL,
  UNIQUE(agent_id,client_event_id), CHECK(result<>'failed' OR failure_code IS NOT NULL)
);
CREATE INDEX observations_latest ON observations(server_id,boss_id,observed_at DESC);
CREATE INDEX observations_agent_time ON observations(agent_id,observed_at DESC);
CREATE TABLE kill_events (
  id uuid PRIMARY KEY, clan_id uuid NOT NULL REFERENCES clans, server_id text NOT NULL REFERENCES servers,
  boss_id integer NOT NULL REFERENCES bosses, killed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), author_id uuid NOT NULL REFERENCES users,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), voided_at timestamptz,
  FOREIGN KEY(clan_id,author_id) REFERENCES memberships(clan_id,user_id),
  CHECK(killed_at<=recorded_at)
);
CREATE INDEX kills_latest ON kill_events(clan_id,server_id,boss_id,killed_at DESC) WHERE voided_at IS NULL;
CREATE TABLE kill_revisions (
  id uuid PRIMARY KEY, kill_id uuid NOT NULL REFERENCES kill_events, clan_id uuid NOT NULL REFERENCES clans,
  actor_id uuid NOT NULL REFERENCES users, changed_at timestamptz NOT NULL DEFAULT now(),
  before_value jsonb NOT NULL, after_value jsonb NOT NULL
);
-- Private tables default deny. Runtime grants/policies are deliberately absent until
-- authenticated API and integration isolation tests are implemented. No frontend DB access.
ALTER TABLE clans ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
COMMIT;
