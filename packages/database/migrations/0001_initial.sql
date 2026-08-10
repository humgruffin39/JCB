CREATE TABLE users (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_guild_check_at INTEGER NOT NULL
) STRICT;

CREATE TABLE admin_allowlist (
  discord_user_id TEXT PRIMARY KEY,
  added_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (added_by_user_id) REFERENCES users(id)
) STRICT;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (
    account_type IN (
      'central_bank', 'user', 'race_win_pool', 'race_trifecta_pool',
      'trifecta_carryover', 'issuance', 'burn'
    )
  ),
  currency TEXT NOT NULL DEFAULT 'RUP' CHECK (currency = 'RUP'),
  created_at INTEGER NOT NULL,
  UNIQUE(currency, account_type, owner_key)
) STRICT;

CREATE TABLE ledger_transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) STRICT;
CREATE INDEX ledger_transactions_reference_idx
  ON ledger_transactions(reference_type, reference_id);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES ledger_transactions(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) STRICT;
CREATE INDEX ledger_entries_account_created_idx
  ON ledger_entries(account_id, created_at);
CREATE INDEX ledger_entries_transaction_idx
  ON ledger_entries(transaction_id);

CREATE TABLE account_balances (
  account_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) STRICT;

CREATE TABLE horses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'resting', 'retired')),
  running_style TEXT NOT NULL CHECK (running_style IN ('front_runner', 'closer')),
  speed INTEGER NOT NULL CHECK (speed BETWEEN 0 AND 100),
  start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 100),
  acceleration INTEGER NOT NULL CHECK (acceleration BETWEEN 0 AND 100),
  stamina INTEGER NOT NULL CHECK (stamina BETWEEN 0 AND 100),
  late_kick INTEGER NOT NULL CHECK (late_kick BETWEEN 0 AND 100),
  condition_stability INTEGER NOT NULL CHECK (condition_stability BETWEEN 0 AND 100),
  aptitude_sprint INTEGER NOT NULL CHECK (aptitude_sprint BETWEEN 0 AND 100),
  aptitude_mile INTEGER NOT NULL CHECK (aptitude_mile BETWEEN 0 AND 100),
  aptitude_middle INTEGER NOT NULL CHECK (aptitude_middle BETWEEN 0 AND 100),
  aptitude_long INTEGER NOT NULL CHECK (aptitude_long BETWEEN 0 AND 100),
  aptitude_firm INTEGER NOT NULL CHECK (aptitude_firm BETWEEN 0 AND 100),
  aptitude_good INTEGER NOT NULL CHECK (aptitude_good BETWEEN 0 AND 100),
  aptitude_heavy INTEGER NOT NULL CHECK (aptitude_heavy BETWEEN 0 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  retired_at INTEGER
) STRICT;

CREATE TABLE races (
  id TEXT PRIMARY KEY,
  race_date TEXT NOT NULL UNIQUE CHECK (race_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'midweek', 'saturday_night')),
  status TEXT NOT NULL CHECK (
    status IN (
      'draft', 'locked', 'simulating', 'betting_open', 'betting_closed',
      'ready', 'running', 'finished', 'settling', 'settled', 'cancelled', 'failed'
    )
  ),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  distance_m INTEGER NOT NULL CHECK (distance_m > 0),
  going TEXT NOT NULL CHECK (going IN ('firm', 'good', 'heavy')),
  scheduled_at INTEGER NOT NULL,
  betting_opens_at INTEGER NOT NULL,
  betting_closes_at INTEGER NOT NULL,
  viewer_opens_at INTEGER NOT NULL,
  input_hash TEXT,
  simulation_version TEXT,
  odds_version TEXT,
  timeline_duration_ms INTEGER,
  final_odds_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  cancel_reason TEXT,
  CHECK (betting_opens_at < betting_closes_at),
  CHECK (betting_closes_at <= scheduled_at),
  CHECK (viewer_opens_at <= scheduled_at)
) STRICT;

CREATE TABLE race_entries (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  horse_id TEXT NOT NULL,
  horse_number INTEGER NOT NULL CHECK (horse_number BETWEEN 1 AND 8),
  condition TEXT NOT NULL CHECK (
    condition IN ('terrible', 'poor', 'normal', 'good', 'excellent')
  ),
  tie_breaker REAL NOT NULL CHECK (tie_breaker >= 0 AND tie_breaker < 1),
  snapshot_name TEXT NOT NULL,
  snapshot_running_style TEXT NOT NULL CHECK (
    snapshot_running_style IN ('front_runner', 'closer')
  ),
  snapshot_speed INTEGER NOT NULL CHECK (snapshot_speed BETWEEN 0 AND 100),
  snapshot_start INTEGER NOT NULL CHECK (snapshot_start BETWEEN 0 AND 100),
  snapshot_acceleration INTEGER NOT NULL CHECK (snapshot_acceleration BETWEEN 0 AND 100),
  snapshot_stamina INTEGER NOT NULL CHECK (snapshot_stamina BETWEEN 0 AND 100),
  snapshot_late_kick INTEGER NOT NULL CHECK (snapshot_late_kick BETWEEN 0 AND 100),
  snapshot_condition_stability INTEGER NOT NULL CHECK (
    snapshot_condition_stability BETWEEN 0 AND 100
  ),
  snapshot_aptitude_sprint INTEGER NOT NULL CHECK (snapshot_aptitude_sprint BETWEEN 0 AND 100),
  snapshot_aptitude_mile INTEGER NOT NULL CHECK (snapshot_aptitude_mile BETWEEN 0 AND 100),
  snapshot_aptitude_middle INTEGER NOT NULL CHECK (snapshot_aptitude_middle BETWEEN 0 AND 100),
  snapshot_aptitude_long INTEGER NOT NULL CHECK (snapshot_aptitude_long BETWEEN 0 AND 100),
  snapshot_aptitude_firm INTEGER NOT NULL CHECK (snapshot_aptitude_firm BETWEEN 0 AND 100),
  snapshot_aptitude_good INTEGER NOT NULL CHECK (snapshot_aptitude_good BETWEEN 0 AND 100),
  snapshot_aptitude_heavy INTEGER NOT NULL CHECK (snapshot_aptitude_heavy BETWEEN 0 AND 100),
  finish_position INTEGER CHECK (finish_position BETWEEN 1 AND 8),
  finish_time_ms INTEGER CHECK (finish_time_ms > 0),
  UNIQUE(race_id, horse_number),
  UNIQUE(race_id, horse_id),
  FOREIGN KEY (race_id) REFERENCES races(id),
  FOREIGN KEY (horse_id) REFERENCES horses(id)
) STRICT;

CREATE TABLE race_simulations (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  race_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('odds', 'official')),
  status TEXT NOT NULL,
  seed_ciphertext TEXT NOT NULL,
  prng_version TEXT NOT NULL,
  simulation_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_hash TEXT,
  encrypted_result_blob TEXT,
  timeline_object_key TEXT,
  timeline_sha256 TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT,
  error_detail_redacted TEXT,
  UNIQUE(race_id, race_version, kind),
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE TABLE odds_probabilities (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('win', 'trifecta')),
  selection_code TEXT NOT NULL,
  model_probability REAL NOT NULL CHECK (model_probability > 0),
  base_odds REAL NOT NULL CHECK (base_odds > 0),
  seed_stake INTEGER NOT NULL CHECK (seed_stake >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(race_id, pool_type, selection_code),
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE TABLE bet_pools (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('win', 'trifecta')),
  account_id TEXT NOT NULL,
  seed_liquidity INTEGER NOT NULL CHECK (seed_liquidity >= 0),
  user_stake_total INTEGER NOT NULL DEFAULT 0 CHECK (user_stake_total >= 0),
  finalized_at INTEGER,
  status TEXT NOT NULL,
  UNIQUE(race_id, pool_type),
  FOREIGN KEY (race_id) REFERENCES races(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) STRICT;

CREATE TABLE seed_positions (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  selection_code TEXT NOT NULL,
  stake INTEGER NOT NULL CHECK (stake >= 0),
  payout INTEGER CHECK (payout >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(pool_id, selection_code),
  FOREIGN KEY (pool_id) REFERENCES bet_pools(id)
) STRICT;

CREATE TABLE bets (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  selection_code TEXT NOT NULL,
  stake INTEGER NOT NULL CHECK (stake >= 100),
  status TEXT NOT NULL CHECK (status IN ('open', 'won', 'lost', 'refunded')),
  payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
  interaction_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  FOREIGN KEY (pool_id) REFERENCES bet_pools(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) STRICT;
CREATE INDEX bets_pool_selection_idx ON bets(pool_id, selection_code);
CREATE INDEX bets_user_idx ON bets(user_id, created_at);

CREATE TABLE trifecta_carryover (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  account_id TEXT NOT NULL UNIQUE,
  amount_projection INTEGER NOT NULL CHECK (amount_projection >= 0),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) STRICT;

CREATE TABLE interaction_sessions (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  race_version INTEGER NOT NULL,
  step TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;
CREATE INDEX interaction_sessions_expiry_idx ON interaction_sessions(expires_at);

CREATE TABLE web_login_tickets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL,
  race_id TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE TABLE web_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_guild_check_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'warn_missing_race', 'simulate_race', 'publish_race', 'grant_relief',
      'refresh_race_message', 'open_viewer', 'close_betting', 'mark_running',
      'mark_finished', 'settle_race', 'refresh_rankings', 'backup_check',
      'economic_integrity_check'
    )
  ),
  deduplication_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'completed', 'retry_wait', 'dead_letter')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at INTEGER,
  locked_by TEXT,
  last_error_code TEXT,
  last_error_redacted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX scheduled_jobs_due_idx ON scheduled_jobs(status, run_at);

CREATE TABLE discord_messages (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  race_id TEXT,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(purpose, race_id),
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

CREATE TABLE ranking_snapshots (
  id TEXT PRIMARY KEY,
  calculated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  source_ledger_transaction_id TEXT,
  FOREIGN KEY (source_ledger_transaction_id) REFERENCES ledger_transactions(id)
) STRICT;

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
) STRICT;
CREATE INDEX audit_logs_target_idx ON audit_logs(target_type, target_id, created_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by_user_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) STRICT;

CREATE TABLE setting_history (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by_user_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) STRICT;
CREATE INDEX setting_history_key_idx ON setting_history(key, updated_at);

CREATE TABLE idempotency_records (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  result_reference_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TRIGGER ledger_transactions_no_update
BEFORE UPDATE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger transactions are append-only');
END;
CREATE TRIGGER ledger_transactions_no_delete
BEFORE DELETE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger transactions are append-only');
END;

CREATE TRIGGER ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are append-only');
END;

CREATE TRIGGER ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are append-only');
END;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are append-only');
END;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are append-only');
END;

CREATE TRIGGER app_settings_history_insert
AFTER INSERT ON app_settings
BEGIN
  INSERT INTO setting_history (id, key, value_json, updated_by_user_id, updated_at)
  VALUES (lower(hex(randomblob(16))), NEW.key, NEW.value_json, NEW.updated_by_user_id, NEW.updated_at);
END;

CREATE TRIGGER app_settings_history_update
AFTER UPDATE ON app_settings
BEGIN
  INSERT INTO setting_history (id, key, value_json, updated_by_user_id, updated_at)
  VALUES (lower(hex(randomblob(16))), NEW.key, NEW.value_json, NEW.updated_by_user_id, NEW.updated_at);
END;
