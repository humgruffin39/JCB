ALTER TABLE races
ADD COLUMN simulation_config_json TEXT NOT NULL
DEFAULT '{"noiseStandardDeviation":0.022,"fatigueMaximum":0.12}'
CHECK (json_valid(simulation_config_json));
