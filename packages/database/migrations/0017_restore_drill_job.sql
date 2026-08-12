CREATE TABLE scheduled_jobs_v2 (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'warn_missing_race', 'simulate_race', 'publish_race', 'grant_relief',
      'refresh_race_message', 'open_viewer', 'close_betting', 'mark_running',
      'mark_finished', 'settle_race', 'refresh_rankings', 'backup_check',
      'restore_drill', 'economic_integrity_check'
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

INSERT INTO scheduled_jobs_v2
SELECT id, job_type, deduplication_key, payload_json, run_at, status, attempt_count,
       locked_at, locked_by, last_error_code, last_error_redacted, created_at, updated_at
FROM scheduled_jobs;

DROP TABLE scheduled_jobs;
ALTER TABLE scheduled_jobs_v2 RENAME TO scheduled_jobs;

CREATE INDEX scheduled_jobs_due_idx ON scheduled_jobs(status, run_at);
CREATE INDEX scheduled_jobs_completed_retention_idx
ON scheduled_jobs(updated_at) WHERE status = 'completed';
