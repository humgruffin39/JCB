CREATE TABLE counting_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  current_count TEXT NOT NULL,
  best_count TEXT NOT NULL,
  failure_counts_json TEXT NOT NULL,
  successful_counts_json TEXT NOT NULL,
  applied_history_imports_json TEXT NOT NULL,
  last_processed_message_id TEXT,
  last_accepted_message_id TEXT,
  last_counter_user_id TEXT,
  pending_failures_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
