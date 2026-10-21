-- Map display positions are different from in-game XYZ. Existing spawn_points remain untouched.
CREATE TABLE IF NOT EXISTS boss_map_points (
 boss_id integer NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
 point_index integer NOT NULL CHECK(point_index >= 0),
 map_x_percent numeric(10,6) NOT NULL CHECK(map_x_percent BETWEEN 0 AND 100),
 map_y_percent numeric(10,6) NOT NULL CHECK(map_y_percent BETWEEN 0 AND 100),
 source_url text NOT NULL,
 PRIMARY KEY (boss_id,point_index)
);
-- Scout character records already contain boss_id; do not duplicate their authoritative assignment.
CREATE INDEX IF NOT EXISTS scout_characters_assigned_boss ON scout_characters(boss_id) WHERE boss_id IS NOT NULL;
REVOKE ALL ON boss_map_points FROM PUBLIC;
