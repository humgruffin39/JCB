ALTER TABLE web_sessions ADD COLUMN reauthenticated_at INTEGER;

ALTER TABLE oauth_login_states
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'
  CHECK (purpose IN ('login', 'emergency_reauthentication'));
ALTER TABLE oauth_login_states ADD COLUMN existing_session_id TEXT;
