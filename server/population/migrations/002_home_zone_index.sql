ALTER TABLE npc ADD COLUMN home_zone_id TEXT NOT NULL DEFAULT 'off_map';
UPDATE npc SET home_zone_id = (
  SELECT a.zone_id FROM household h
  JOIN map_anchor a ON a.id = h.home_anchor_id
  WHERE h.id = npc.household_id
);
CREATE INDEX npc_home_zone_idx ON npc(home_zone_id, id);
