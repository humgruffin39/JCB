CREATE TABLE race_entry_drafts (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  horse_id TEXT NOT NULL,
  horse_number INTEGER NOT NULL CHECK (horse_number BETWEEN 1 AND 8),
  UNIQUE(race_id, horse_number),
  UNIQUE(race_id, horse_id),
  FOREIGN KEY (race_id) REFERENCES races(id),
  FOREIGN KEY (horse_id) REFERENCES horses(id)
) STRICT;
