CREATE TABLE object_publications_v3 (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  body BLOB NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'dead_letter', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  locked_at INTEGER,
  locked_by TEXT,
  last_error_redacted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO object_publications_v3
SELECT id, object_key, body, metadata_json, status, attempt_count, next_attempt_at,
       locked_at, locked_by, last_error_redacted, created_at, updated_at
FROM object_publications;

DROP TABLE object_publications;
ALTER TABLE object_publications_v3 RENAME TO object_publications;

CREATE INDEX object_publications_due_idx
ON object_publications(status, next_attempt_at);
