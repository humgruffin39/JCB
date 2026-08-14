CREATE TABLE races_without_date_unique (
  id TEXT PRIMARY KEY,
  race_date TEXT NOT NULL CHECK (race_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
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
  simulation_config_json TEXT NOT NULL
    DEFAULT '{"noiseStandardDeviation":0.022,"fatigueMaximum":0.12}'
    CHECK (json_valid(simulation_config_json)),
  seed_liquidity_diagnostics_json TEXT CHECK (
    seed_liquidity_diagnostics_json IS NULL
    OR json_valid(seed_liquidity_diagnostics_json)
  ),
  surface TEXT NOT NULL DEFAULT 'turf' CHECK (surface IN ('turf', 'dirt')),
  CHECK (betting_opens_at < betting_closes_at),
  CHECK (betting_closes_at <= scheduled_at),
  CHECK (viewer_opens_at <= scheduled_at)
) STRICT;

INSERT INTO races_without_date_unique (
  id, race_date, name, kind, status, version, distance_m, going,
  scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
  input_hash, simulation_version, odds_version, timeline_duration_ms,
  final_odds_json, created_at, updated_at, cancelled_at, cancel_reason,
  simulation_config_json, seed_liquidity_diagnostics_json, surface
)
SELECT
  id, race_date, name, kind, status, version, distance_m, going,
  scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
  input_hash, simulation_version, odds_version, timeline_duration_ms,
  final_odds_json, created_at, updated_at, cancelled_at, cancel_reason,
  simulation_config_json, seed_liquidity_diagnostics_json, surface
FROM races;

DROP TABLE races;
ALTER TABLE races_without_date_unique RENAME TO races;
