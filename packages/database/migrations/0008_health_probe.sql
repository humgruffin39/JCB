CREATE TABLE health_probes (
  id TEXT PRIMARY KEY CHECK (id = 'database'),
  nonce TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
