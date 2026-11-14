ALTER TABLE sim_place ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
CREATE INDEX sim_place_active_kind_idx ON sim_place(active, kind, id);

CREATE TABLE map_building_use (
  anchor_id TEXT PRIMARY KEY REFERENCES map_anchor(id),
  uses_json TEXT NOT NULL CHECK (json_valid(uses_json)),
  residential_units INTEGER NOT NULL CHECK (residential_units >= 0),
  office_area_sqft INTEGER NOT NULL CHECK (office_area_sqft >= 0),
  retail_area_sqft INTEGER NOT NULL CHECK (retail_area_sqft >= 0),
  bbls_json TEXT NOT NULL CHECK (json_valid(bbls_json)),
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json))
) STRICT;

CREATE TABLE sim_household_home (
  household_id INTEGER PRIMARY KEY REFERENCES household(id),
  anchor_id TEXT NOT NULL REFERENCES map_anchor(id)
) STRICT;

CREATE TABLE sim_place_source (
  place_id TEXT PRIMARY KEY REFERENCES sim_place(id),
  dataset TEXT NOT NULL,
  source_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  distance_m REAL,
  fetched_at TEXT
) STRICT;
