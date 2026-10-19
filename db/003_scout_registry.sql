BEGIN;
CREATE TABLE operators(user_id uuid PRIMARY KEY REFERENCES users);
REVOKE ALL ON operators FROM PUBLIC;
CREATE FUNCTION is_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM operators WHERE user_id=api_user())
$$;
CREATE FUNCTION fleet_manager(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT is_operator() OR EXISTS(SELECT 1 FROM agents a JOIN subscriptions s ON s.clan_id=a.owner_clan_id WHERE a.id=target AND s.own_agents AND can_access(a.owner_clan_id,'manage_agents'))
$$;
CREATE TABLE fleet_settings(agent_id uuid PRIMARY KEY REFERENCES agents, running boolean NOT NULL DEFAULT false, timer_clan_id uuid REFERENCES clans);
ALTER TABLE fleet_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_scope ON fleet_settings FOR SELECT TO lu4_api USING(agent_id=agent_scope() OR fleet_manager(agent_id));
CREATE POLICY settings_update ON fleet_settings FOR UPDATE TO lu4_api USING(fleet_manager(agent_id)) WITH CHECK(fleet_manager(agent_id));
CREATE POLICY settings_write ON fleet_settings FOR INSERT TO lu4_api WITH CHECK(fleet_manager(agent_id));
GRANT SELECT,INSERT,UPDATE ON fleet_settings TO lu4_api;
CREATE FUNCTION scout_due(target uuid, boss integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM agents a JOIN fleet_settings f ON f.agent_id=a.id
 WHERE a.id=target AND target=agent_scope() AND f.running AND a.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM kill_events k JOIN boss_rules r ON r.server_id=k.server_id AND r.boss_id=k.boss_id
 WHERE k.clan_id=coalesce(a.owner_clan_id,f.timer_clan_id) AND k.server_id=a.server_id AND k.boss_id=boss AND k.voided_at IS NULL
 AND k.killed_at<=now() AND r.min_minutes IS NOT NULL AND k.killed_at+r.min_minutes*interval '1 minute'>now()))
$$;
REVOKE ALL ON FUNCTION scout_due(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scout_due(uuid,integer) TO lu4_api;
CREATE TABLE scout_accounts(
 id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agents, local_key text NOT NULL CHECK(length(local_key) BETWEEN 1 AND 128),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 128), enabled boolean NOT NULL DEFAULT false,
 seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE(agent_id,local_key), UNIQUE(id,agent_id)
);
CREATE TABLE scout_characters(
 id uuid PRIMARY KEY, account_id uuid NOT NULL, agent_id uuid NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 63), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
 enabled boolean NOT NULL DEFAULT false,boss_id integer REFERENCES bosses,
 expected_x integer,expected_y integer,expected_z integer,radius integer CHECK(radius BETWEEN 1 AND 5000),
 last_attempt_at timestamptz,retry_at timestamptz,seen_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,agent_id) REFERENCES scout_accounts(id,agent_id), UNIQUE(account_id,slot),
 CHECK(NOT enabled OR (boss_id IS NOT NULL AND expected_x IS NOT NULL AND expected_y IS NOT NULL AND expected_z IS NOT NULL AND radius IS NOT NULL))
);
CREATE TABLE scout_leases(
 id uuid PRIMARY KEY,agent_id uuid NOT NULL REFERENCES agents,account_id uuid NOT NULL REFERENCES scout_accounts,
 character_id uuid NOT NULL REFERENCES scout_characters, client_id text NOT NULL,
 expires_at timestamptz NOT NULL,finished_at timestamptz
);
CREATE UNIQUE INDEX scout_account_active ON scout_leases(account_id) WHERE finished_at IS NULL;
CREATE UNIQUE INDEX scout_client_active ON scout_leases(agent_id,client_id) WHERE finished_at IS NULL;
ALTER TABLE scout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_scope ON scout_accounts TO lu4_api USING(agent_id=agent_scope() OR fleet_manager(agent_id)) WITH CHECK(agent_id=agent_scope() OR fleet_manager(agent_id));
CREATE POLICY character_scope ON scout_characters TO lu4_api USING(agent_id=agent_scope() OR fleet_manager(agent_id)) WITH CHECK(agent_id=agent_scope() OR fleet_manager(agent_id));
CREATE POLICY lease_scope ON scout_leases TO lu4_api USING(agent_id=agent_scope() OR fleet_manager(agent_id)) WITH CHECK(agent_id=agent_scope() OR fleet_manager(agent_id));
GRANT SELECT,INSERT,UPDATE ON scout_accounts,scout_characters,scout_leases TO lu4_api;
CREATE POLICY fleet_read ON agents FOR SELECT TO lu4_api USING(fleet_manager(id));
GRANT SELECT(id,owner_clan_id,name,server_id,last_seen_at,revoked_at) ON agents TO lu4_api;
REVOKE ALL ON FUNCTION is_operator(),fleet_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_operator(),fleet_manager(uuid) TO lu4_api;
COMMIT;
