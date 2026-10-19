BEGIN;
ALTER TABLE scout_leases ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE scout_leases ADD COLUMN boss_id integer REFERENCES bosses;
ALTER TABLE scout_leases ADD COLUMN character_name text;
UPDATE scout_leases l SET boss_id=c.boss_id,character_name=c.name FROM scout_characters c WHERE c.id=l.character_id;
ALTER TABLE scout_leases ADD COLUMN assignment jsonb;
-- Pre-upgrade assignments lack immutable snapshots: expire them for a clean retry.
UPDATE scout_leases SET finished_at=now() WHERE finished_at IS NULL;
ALTER TABLE observations ADD COLUMN lease_id uuid REFERENCES scout_leases;
CREATE UNIQUE INDEX observation_lease ON observations(lease_id) WHERE lease_id IS NOT NULL;
COMMIT;
