CREATE TABLE population_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE map_anchor (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('building', 'road_node', 'road', 'off_map')),
  zone_id TEXT NOT NULL,
  name TEXT,
  x REAL,
  z REAL,
  map_hash TEXT NOT NULL,
  CHECK ((kind = 'off_map' AND x IS NULL AND z IS NULL) OR
         (kind <> 'off_map' AND x IS NOT NULL AND z IS NOT NULL))
) STRICT;

CREATE TABLE household (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  home_anchor_id TEXT NOT NULL REFERENCES map_anchor(id),
  profile_seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL
) STRICT;

CREATE TABLE npc (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  household_id INTEGER NOT NULL REFERENCES household(id),
  display_name TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('worker', 'student', 'other')),
  routine_code TEXT NOT NULL,
  appearance_seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL
) STRICT;

CREATE TABLE npc_assignment (
  npc_id INTEGER NOT NULL REFERENCES npc(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'school')),
  anchor_id TEXT NOT NULL REFERENCES map_anchor(id),
  schedule_code TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('synthetic', 'verified')),
  PRIMARY KEY (npc_id, kind)
) STRICT;

CREATE TABLE npc_state (
  npc_id INTEGER PRIMARY KEY REFERENCES npc(id) ON DELETE CASCADE,
  world_time_ms INTEGER NOT NULL CHECK (world_time_ms >= 0),
  activity TEXT NOT NULL,
  destination_anchor_id TEXT REFERENCES map_anchor(id),
  road_id TEXT REFERENCES map_anchor(id),
  route_start_ms INTEGER,
  route_end_ms INTEGER,
  status_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(status_json)),
  CHECK (route_start_ms IS NULL OR route_end_ms IS NULL OR route_end_ms >= route_start_ms)
) STRICT;

CREATE TABLE npc_event (
  id INTEGER PRIMARY KEY,
  npc_id INTEGER NOT NULL REFERENCES npc(id) ON DELETE CASCADE,
  world_time_ms INTEGER NOT NULL CHECK (world_time_ms >= 0),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  idempotency_key TEXT UNIQUE
) STRICT;

CREATE INDEX household_home_idx ON household(home_anchor_id, id);
CREATE INDEX npc_household_idx ON npc(household_id, id);
CREATE INDEX assignment_anchor_idx ON npc_assignment(anchor_id, npc_id);
CREATE INDEX state_road_idx ON npc_state(road_id, npc_id) WHERE road_id IS NOT NULL;
CREATE INDEX event_npc_time_idx ON npc_event(npc_id, world_time_ms, id);
