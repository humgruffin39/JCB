-- Replace weather-dependent going aptitudes with course-surface aptitudes.
-- Legacy columns remain populated for rollback compatibility with pre-0009 builds.
ALTER TABLE horses
  ADD COLUMN aptitude_turf INTEGER NOT NULL DEFAULT 50
  CHECK (aptitude_turf BETWEEN 0 AND 100);
ALTER TABLE horses
  ADD COLUMN aptitude_dirt INTEGER NOT NULL DEFAULT 50
  CHECK (aptitude_dirt BETWEEN 0 AND 100);

UPDATE horses
SET aptitude_turf = aptitude_firm,
    aptitude_dirt = CAST(ROUND((aptitude_good + aptitude_heavy) / 2.0) AS INTEGER);

ALTER TABLE races
  ADD COLUMN surface TEXT NOT NULL DEFAULT 'turf'
  CHECK (surface IN ('turf', 'dirt'));

ALTER TABLE race_entries
  ADD COLUMN snapshot_aptitude_turf INTEGER NOT NULL DEFAULT 50
  CHECK (snapshot_aptitude_turf BETWEEN 0 AND 100);
ALTER TABLE race_entries
  ADD COLUMN snapshot_aptitude_dirt INTEGER NOT NULL DEFAULT 50
  CHECK (snapshot_aptitude_dirt BETWEEN 0 AND 100);

UPDATE race_entries
SET snapshot_aptitude_turf = snapshot_aptitude_firm,
    snapshot_aptitude_dirt =
      CAST(ROUND((snapshot_aptitude_good + snapshot_aptitude_heavy) / 2.0) AS INTEGER);
