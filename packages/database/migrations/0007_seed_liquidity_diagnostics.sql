ALTER TABLE races ADD COLUMN seed_liquidity_diagnostics_json TEXT
  CHECK (
    seed_liquidity_diagnostics_json IS NULL
    OR json_valid(seed_liquidity_diagnostics_json)
  );
