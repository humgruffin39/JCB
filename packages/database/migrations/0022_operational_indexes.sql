-- Race-history lookup used by adaptive seed-liquidity planning.
CREATE INDEX races_kind_scheduled_idx ON races(kind, scheduled_at DESC);

-- Open-ticket scans used by settlement and cancellation.
CREATE INDEX accounts_type_owner_idx ON accounts(account_type, owner_key);
CREATE INDEX bets_pool_status_created_idx
  ON bets(pool_id, status, created_at, id);

-- Retention scans for Discord Activity records.
CREATE INDEX activity_launch_intents_expiry_idx
  ON activity_launch_intents(expires_at);
CREATE INDEX activity_sessions_revoked_idx
  ON activity_sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX activity_instances_last_verified_idx
  ON activity_instances(last_verified_at);
