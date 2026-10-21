-- Wiki map positions are separate from in-game XYZ; preserve existing spawn_points.
CREATE TABLE IF NOT EXISTS boss_map_points (
 boss_id integer NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
 point_index integer NOT NULL CHECK(point_index >= 0),
 map_x_percent numeric(10,6) NOT NULL CHECK(map_x_percent BETWEEN 0 AND 100),
 map_y_percent numeric(10,6) NOT NULL CHECK(map_y_percent BETWEEN 0 AND 100),
 source_url text NOT NULL,
 PRIMARY KEY (boss_id,point_index)
);
REVOKE ALL ON boss_map_points FROM PUBLIC;
