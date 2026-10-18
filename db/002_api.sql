BEGIN;
CREATE ROLE lu4_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lu4_api;
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE agent_targets (
  agent_id uuid NOT NULL REFERENCES agents, boss_id integer NOT NULL REFERENCES bosses,
  PRIMARY KEY(agent_id,boss_id)
);
ALTER TABLE observations ADD COLUMN owner_clan_id uuid REFERENCES clans;
ALTER TABLE observations ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}';
ALTER TABLE observations ADD COLUMN payload_hash text;
UPDATE observations o SET owner_clan_id=a.owner_clan_id FROM agents a WHERE a.id=o.agent_id;
ALTER TABLE kill_events DROP CONSTRAINT kill_events_check;
-- A correction can be later than the original record but never later than the transaction.
ALTER TABLE kill_events ADD CHECK(killed_at<=now());
ALTER TABLE kill_events ADD UNIQUE(id,clan_id);
ALTER TABLE kill_revisions ADD FOREIGN KEY(kill_id,clan_id) REFERENCES kill_events(id,clan_id);

CREATE FUNCTION api_user() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.user_id',true),'')::uuid
$$;
CREATE FUNCTION api_clan() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.clan_id',true),'')::uuid
$$;
CREATE FUNCTION can_access(target uuid, capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM memberships m JOIN subscriptions s ON s.clan_id=m.clan_id
 WHERE m.user_id=api_user() AND m.clan_id=target AND m.active AND s.site_until>now() AND capability=ANY(m.capabilities))
$$;
CREATE FUNCTION authenticate_user(token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT user_id FROM sessions WHERE token_hash=token AND revoked_at IS NULL AND expires_at>now()
$$;
CREATE FUNCTION authenticate_agent(token text) RETURNS TABLE(id uuid,server_id text,owner_clan_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.id,a.server_id,a.owner_clan_id FROM agents a
 WHERE a.token_hash=token AND a.revoked_at IS NULL AND (a.owner_clan_id IS NULL OR EXISTS(
 SELECT 1 FROM subscriptions s WHERE s.clan_id=a.owner_clan_id AND s.own_agents AND s.site_until>now()))
$$;
CREATE FUNCTION agent_scope() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.agent_id',true),'')::uuid
$$;
CREATE FUNCTION observation_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 SELECT owner_clan_id,server_id INTO NEW.owner_clan_id,NEW.server_id FROM agents WHERE id=NEW.agent_id;
 IF NOT EXISTS(SELECT 1 FROM agent_targets WHERE agent_id=NEW.agent_id AND boss_id=NEW.boss_id) THEN
 RAISE EXCEPTION 'Boss is not assigned to agent' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER observations_scope BEFORE INSERT ON observations FOR EACH ROW EXECUTE FUNCTION observation_owner();

GRANT SELECT ON bosses,spawn_points,drops,boss_rules,servers TO lu4_api;
GRANT SELECT ON clans,memberships,subscriptions,service_grants,kill_events,kill_revisions,observations,agent_targets TO lu4_api;
GRANT INSERT,UPDATE ON kill_events TO lu4_api;
GRANT INSERT ON kill_revisions,observations TO lu4_api;
ALTER TABLE agent_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY targets_read ON agent_targets FOR SELECT TO lu4_api USING(agent_id=agent_scope());
CREATE POLICY member_read ON memberships FOR SELECT TO lu4_api USING(user_id=api_user() AND active);
CREATE POLICY clan_read ON clans FOR SELECT TO lu4_api USING(can_access(id,'view'));
CREATE POLICY subscription_read ON subscriptions FOR SELECT TO lu4_api USING(can_access(clan_id,'view'));
CREATE POLICY grants_read ON service_grants FOR SELECT TO lu4_api USING(clan_id=api_clan() AND can_access(clan_id,'view'));
CREATE POLICY kills_read ON kill_events FOR SELECT TO lu4_api USING(clan_id=api_clan() AND can_access(clan_id,'view'));
CREATE POLICY kills_insert ON kill_events FOR INSERT TO lu4_api WITH CHECK(clan_id=api_clan() AND author_id=api_user() AND can_access(clan_id,'record_kill'));
CREATE POLICY kills_update ON kill_events FOR UPDATE TO lu4_api USING(clan_id=api_clan() AND can_access(clan_id,'record_kill')) WITH CHECK(clan_id=api_clan() AND can_access(clan_id,'record_kill'));
CREATE POLICY revisions_read ON kill_revisions FOR SELECT TO lu4_api USING(clan_id=api_clan() AND can_access(clan_id,'view'));
CREATE POLICY revisions_insert ON kill_revisions FOR INSERT TO lu4_api WITH CHECK(clan_id=api_clan() AND actor_id=api_user() AND can_access(clan_id,'record_kill'));
CREATE POLICY observations_read ON observations FOR SELECT TO lu4_api USING (
 agent_id=agent_scope() OR (
 can_access(api_clan(),'view') AND (owner_clan_id=api_clan() OR (owner_clan_id IS NULL AND EXISTS(
 SELECT 1 FROM service_grants g WHERE g.clan_id=api_clan() AND g.server_id=observations.server_id
 AND g.starts_at<=now() AND g.until_at>now() AND observations.observed_at>=g.starts_at
 AND (g.boss_ids IS NULL OR observations.boss_id=ANY(g.boss_ids))
 AND (g.agent_ids IS NULL OR observations.agent_id=ANY(g.agent_ids))
 )))
 ));
CREATE POLICY observations_insert ON observations FOR INSERT TO lu4_api WITH CHECK(agent_id=agent_scope());
REVOKE ALL ON FUNCTION api_user(),api_clan(),can_access(uuid,text),authenticate_user(text),authenticate_agent(text),agent_scope(),observation_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_user(),api_clan(),can_access(uuid,text),authenticate_user(text),authenticate_agent(text),agent_scope() TO lu4_api;
COMMIT;
