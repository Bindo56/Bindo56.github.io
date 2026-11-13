CREATE TRIGGER household_home_insert
BEFORE INSERT ON household
WHEN (SELECT kind FROM map_anchor WHERE id = NEW.home_anchor_id) NOT IN ('building', 'off_map')
BEGIN
  SELECT RAISE(ABORT, 'Household home must be a building or off-map anchor');
END;

CREATE TRIGGER household_home_update
BEFORE UPDATE OF home_anchor_id ON household
WHEN (SELECT kind FROM map_anchor WHERE id = NEW.home_anchor_id) NOT IN ('building', 'off_map')
BEGIN
  SELECT RAISE(ABORT, 'Household home must be a building or off-map anchor');
END;

CREATE TRIGGER household_zone_update
AFTER UPDATE OF home_anchor_id ON household
BEGIN
  UPDATE npc SET home_zone_id = (SELECT zone_id FROM map_anchor WHERE id = NEW.home_anchor_id)
  WHERE household_id = NEW.id;
END;

CREATE TRIGGER npc_home_zone_insert
BEFORE INSERT ON npc
WHEN NEW.home_zone_id <> (
  SELECT a.zone_id FROM household h JOIN map_anchor a ON a.id = h.home_anchor_id
  WHERE h.id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'NPC home zone does not match household');
END;

CREATE TRIGGER npc_home_zone_update
BEFORE UPDATE OF household_id, home_zone_id ON npc
WHEN NEW.home_zone_id <> (
  SELECT a.zone_id FROM household h JOIN map_anchor a ON a.id = h.home_anchor_id
  WHERE h.id = NEW.household_id
)
BEGIN
  SELECT RAISE(ABORT, 'NPC home zone does not match household');
END;

CREATE TRIGGER assignment_anchor_insert
BEFORE INSERT ON npc_assignment
WHEN (SELECT kind FROM map_anchor WHERE id = NEW.anchor_id) NOT IN ('building', 'off_map')
BEGIN
  SELECT RAISE(ABORT, 'Assignment must be a building or off-map anchor');
END;

CREATE TRIGGER assignment_anchor_update
BEFORE UPDATE OF anchor_id ON npc_assignment
WHEN (SELECT kind FROM map_anchor WHERE id = NEW.anchor_id) NOT IN ('building', 'off_map')
BEGIN
  SELECT RAISE(ABORT, 'Assignment must be a building or off-map anchor');
END;

CREATE TRIGGER state_road_insert
BEFORE INSERT ON npc_state
WHEN NEW.road_id IS NOT NULL AND (SELECT kind FROM map_anchor WHERE id = NEW.road_id) <> 'road'
BEGIN
  SELECT RAISE(ABORT, 'State road ID must reference a road');
END;

CREATE TRIGGER state_road_update
BEFORE UPDATE OF road_id ON npc_state
WHEN NEW.road_id IS NOT NULL AND (SELECT kind FROM map_anchor WHERE id = NEW.road_id) <> 'road'
BEGIN
  SELECT RAISE(ABORT, 'State road ID must reference a road');
END;
