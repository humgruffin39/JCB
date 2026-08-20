CREATE TABLE scheduled_jobs_v3 (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'warn_missing_race', 'grant_racing_role', 'simulate_race', 'publish_race',
      'notify_race_start', 'grant_relief', 'refresh_race_message', 'open_viewer',
      'close_betting', 'mark_running', 'mark_finished', 'settle_race',
      'refresh_rankings', 'backup_check', 'restore_drill', 'economic_integrity_check'
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

INSERT INTO scheduled_jobs_v3
SELECT id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
       locked_at, locked_by, last_error_code, last_error_redacted, created_at, updated_at
FROM scheduled_jobs;

DROP TABLE scheduled_jobs;
ALTER TABLE scheduled_jobs_v3 RENAME TO scheduled_jobs;

CREATE INDEX scheduled_jobs_due_idx ON scheduled_jobs(status, run_at);
CREATE INDEX scheduled_jobs_completed_retention_idx
ON scheduled_jobs(updated_at) WHERE status = 'completed';

INSERT OR IGNORE INTO scheduled_jobs
  (id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
   created_at, updated_at)
SELECT 'racing-role-' || u.id, 'grant_racing_role',
       'grant-racing-role:' || u.discord_user_id,
       json_object('discordUserId', u.discord_user_id), 0, 'pending', 0,
       u.updated_at, u.updated_at
FROM users u
JOIN accounts a ON a.owner_key = u.id AND a.account_type = 'user';

INSERT OR IGNORE INTO scheduled_jobs
  (id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
   created_at, updated_at)
SELECT 'race-reminder-' || r.id || '-' || CAST(r.version AS TEXT),
       'notify_race_start',
       'notify-race-start:' || r.id || ':' || CAST(r.version AS TEXT),
       json_object('raceId', r.id, 'raceVersion', r.version),
       r.scheduled_at - 300000, 'pending', 0, r.updated_at, r.updated_at
FROM races r
WHERE r.status IN ('locked', 'betting_open', 'betting_closed', 'ready')
  AND r.scheduled_at > unixepoch('now') * 1000;
