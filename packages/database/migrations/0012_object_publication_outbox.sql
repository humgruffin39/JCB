CREATE TABLE object_publications (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  body BLOB NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  locked_at INTEGER,
  locked_by TEXT,
  last_error_redacted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX object_publications_due_idx
ON object_publications(status, next_attempt_at);
