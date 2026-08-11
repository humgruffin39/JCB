CREATE INDEX web_login_tickets_expiry_idx ON web_login_tickets(expires_at);
CREATE INDEX web_sessions_expiry_idx ON web_sessions(expires_at);
CREATE INDEX web_sessions_revoked_idx ON web_sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX scheduled_jobs_completed_retention_idx
ON scheduled_jobs(updated_at) WHERE status = 'completed';
CREATE INDEX object_publications_completed_retention_idx
ON object_publications(updated_at) WHERE status = 'completed';
CREATE INDEX ranking_snapshots_retention_idx ON ranking_snapshots(calculated_at);
