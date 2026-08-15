CREATE TABLE activity_launch_intents (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_instance_id TEXT,
  superseded_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE INDEX activity_launch_intents_claim_idx
  ON activity_launch_intents(discord_user_id, guild_id, channel_id, expires_at, created_at)
  WHERE claimed_at IS NULL AND superseded_at IS NULL;

CREATE TABLE activity_instances (
  instance_id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  bound_by_discord_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE TABLE activity_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_guild_check_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (instance_id) REFERENCES activity_instances(instance_id),
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE INDEX activity_sessions_expiry_idx ON activity_sessions(expires_at);
CREATE INDEX activity_sessions_user_instance_idx
  ON activity_sessions(discord_user_id, instance_id, revoked_at);
