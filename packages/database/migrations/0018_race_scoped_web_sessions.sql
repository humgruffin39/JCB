ALTER TABLE web_sessions ADD COLUMN race_id TEXT REFERENCES races(id);
