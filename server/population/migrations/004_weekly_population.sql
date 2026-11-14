CREATE TABLE sim_cohort (
  cohort_key TEXT PRIMARY KEY,
  target_count INTEGER NOT NULL CHECK (target_count > 0),
  seed INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  map_hash TEXT NOT NULL,
  source_version TEXT NOT NULL,
  timezone TEXT NOT NULL CHECK (timezone = 'America/New_York'),
  week_start TEXT NOT NULL,
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_count >= 0)
) STRICT;

CREATE TABLE sim_place (
  id TEXT PRIMARY KEY,
  anchor_id TEXT NOT NULL REFERENCES map_anchor(id),
  zone_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'home', 'office', 'cafe', 'grocery', 'restaurant', 'school',
    'clinic', 'library', 'community', 'retail', 'park_access', 'station_access'
  )),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('synthetic', 'approximate', 'verified')),
  label TEXT NOT NULL
) STRICT;
CREATE INDEX sim_place_kind_zone_idx ON sim_place(kind, zone_id, id);
CREATE INDEX sim_place_anchor_idx ON sim_place(anchor_id, kind);

CREATE TABLE sim_member (
  npc_id INTEGER PRIMARY KEY REFERENCES npc(id),
  cohort_key TEXT NOT NULL REFERENCES sim_cohort(cohort_key),
  profile_seed INTEGER NOT NULL,
  life_stage TEXT NOT NULL CHECK (life_stage IN ('child', 'teen', 'adult', 'older_adult')),
  occupation TEXT NOT NULL,
  shift_pattern TEXT NOT NULL,
  chronotype TEXT NOT NULL CHECK (chronotype IN ('early', 'day', 'late')),
  mobility TEXT NOT NULL CHECK (mobility IN ('walk', 'transit', 'car', 'mixed')),
  social_style TEXT NOT NULL CHECK (social_style IN ('quiet', 'balanced', 'outgoing')),
  interest TEXT NOT NULL,
  goal TEXT NOT NULL,
  home_place_id TEXT NOT NULL REFERENCES sim_place(id),
  work_place_id TEXT REFERENCES sim_place(id),
  cafe_place_id TEXT NOT NULL REFERENCES sim_place(id),
  errand_place_id TEXT NOT NULL REFERENCES sim_place(id),
  leisure_place_id TEXT NOT NULL REFERENCES sim_place(id),
  commute_minute INTEGER NOT NULL CHECK (commute_minute BETWEEN 0 AND 180),
  plan_seed INTEGER NOT NULL,
  profile_version TEXT NOT NULL
) STRICT;
CREATE INDEX sim_member_cohort_idx ON sim_member(cohort_key, npc_id);
CREATE INDEX sim_member_home_idx ON sim_member(home_place_id, npc_id);
CREATE INDEX sim_member_work_idx ON sim_member(work_place_id, npc_id) WHERE work_place_id IS NOT NULL;

CREATE TABLE sim_relationship (
  npc_a_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  npc_b_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  kind TEXT NOT NULL CHECK (kind IN ('family', 'neighbor', 'coworker', 'friend')),
  strength INTEGER NOT NULL CHECK (strength BETWEEN 0 AND 100),
  provenance TEXT NOT NULL CHECK (provenance IN ('synthetic', 'authored')),
  PRIMARY KEY (npc_a_id, npc_b_id, kind),
  CHECK (npc_a_id < npc_b_id)
) STRICT;
CREATE INDEX sim_relationship_b_idx ON sim_relationship(npc_b_id, npc_a_id);

CREATE TABLE sim_week (
  npc_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  week_start TEXT NOT NULL,
  plan_seed INTEGER NOT NULL,
  plan_version TEXT NOT NULL,
  PRIMARY KEY (npc_id, week_start)
) STRICT;
CREATE INDEX sim_week_start_idx ON sim_week(week_start, npc_id);

CREATE TABLE sim_meeting (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  npc_a_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  npc_b_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  place_id TEXT NOT NULL REFERENCES sim_place(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  duration_minute INTEGER NOT NULL CHECK (duration_minute BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
  CHECK (npc_a_id < npc_b_id),
  UNIQUE (week_start, npc_a_id, npc_b_id)
) STRICT;
CREATE INDEX sim_meeting_a_idx ON sim_meeting(npc_a_id, week_start, weekday, start_minute);
CREATE INDEX sim_meeting_b_idx ON sim_meeting(npc_b_id, week_start, weekday, start_minute);

CREATE TABLE sim_interaction (
  id INTEGER PRIMARY KEY,
  world_time_ms INTEGER NOT NULL CHECK (world_time_ms >= 0),
  place_id TEXT REFERENCES sim_place(id),
  kind TEXT NOT NULL,
  outcome_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outcome_json)),
  idempotency_key TEXT UNIQUE
) STRICT;
CREATE TABLE sim_interaction_participant (
  interaction_id INTEGER NOT NULL REFERENCES sim_interaction(id) ON DELETE CASCADE,
  npc_id INTEGER NOT NULL REFERENCES sim_member(npc_id),
  participant_role TEXT NOT NULL,
  PRIMARY KEY (interaction_id, npc_id)
) STRICT;
CREATE INDEX sim_interaction_participant_npc_idx ON sim_interaction_participant(npc_id, interaction_id);
