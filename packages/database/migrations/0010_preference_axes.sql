-- Model distance and surface as centered preference axes.
ALTER TABLE horses
  ADD COLUMN distance_preference INTEGER NOT NULL DEFAULT 0
  CHECK (distance_preference BETWEEN -100 AND 100);
ALTER TABLE horses
  ADD COLUMN surface_preference INTEGER NOT NULL DEFAULT 0
  CHECK (surface_preference BETWEEN -100 AND 100);

UPDATE horses
SET distance_preference = aptitude_long - aptitude_sprint,
    surface_preference = aptitude_dirt - aptitude_turf;

ALTER TABLE race_entries
  ADD COLUMN snapshot_distance_preference INTEGER NOT NULL DEFAULT 0
  CHECK (snapshot_distance_preference BETWEEN -100 AND 100);
ALTER TABLE race_entries
  ADD COLUMN snapshot_surface_preference INTEGER NOT NULL DEFAULT 0
  CHECK (snapshot_surface_preference BETWEEN -100 AND 100);

UPDATE race_entries
SET snapshot_distance_preference =
      snapshot_aptitude_long - snapshot_aptitude_sprint,
    snapshot_surface_preference =
      snapshot_aptitude_dirt - snapshot_aptitude_turf;
