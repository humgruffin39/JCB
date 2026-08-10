ALTER TABLE web_sessions
ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'ticket'
CHECK (auth_method IN ('ticket', 'discord_oauth'));

CREATE TABLE oauth_login_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX oauth_login_states_expiry_idx ON oauth_login_states(expires_at);
