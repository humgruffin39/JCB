CREATE TABLE accounts_v2 (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (
    account_type IN (
      'central_bank', 'user', 'race_win_pool', 'race_place_pool', 'race_quinella_pool',
      'race_exacta_pool', 'race_wide_pool', 'race_trio_pool', 'race_trifecta_pool',
      'trifecta_carryover', 'issuance', 'burn'
    )
  ),
  currency TEXT NOT NULL DEFAULT 'RUP' CHECK (currency = 'RUP'),
  created_at INTEGER NOT NULL,
  UNIQUE(currency, account_type, owner_key)
) STRICT;

INSERT INTO accounts_v2
SELECT id, owner_type, owner_key, account_type, currency, created_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_v2 RENAME TO accounts;
CREATE INDEX accounts_type_owner_idx ON accounts(account_type, owner_key);

CREATE TABLE odds_probabilities_v2 (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (
    pool_type IN ('win', 'place', 'quinella', 'exacta', 'wide', 'trio', 'trifecta')
  ),
  selection_code TEXT NOT NULL,
  model_probability REAL NOT NULL CHECK (model_probability > 0),
  base_odds REAL NOT NULL CHECK (base_odds > 0),
  seed_stake INTEGER NOT NULL CHECK (seed_stake >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE(race_id, pool_type, selection_code),
  FOREIGN KEY (race_id) REFERENCES races(id)
) STRICT;

INSERT INTO odds_probabilities_v2
SELECT id, race_id, pool_type, selection_code, model_probability, base_odds, seed_stake, created_at
FROM odds_probabilities;

DROP TABLE odds_probabilities;
ALTER TABLE odds_probabilities_v2 RENAME TO odds_probabilities;

CREATE TABLE bet_pools_v2 (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (
    pool_type IN ('win', 'place', 'quinella', 'exacta', 'wide', 'trio', 'trifecta')
  ),
  account_id TEXT NOT NULL,
  seed_liquidity INTEGER NOT NULL CHECK (seed_liquidity >= 0),
  user_stake_total INTEGER NOT NULL DEFAULT 0 CHECK (user_stake_total >= 0),
  finalized_at INTEGER,
  status TEXT NOT NULL,
  UNIQUE(race_id, pool_type),
  FOREIGN KEY (race_id) REFERENCES races(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) STRICT;

INSERT INTO bet_pools_v2
SELECT id, race_id, pool_type, account_id, seed_liquidity, user_stake_total, finalized_at, status
FROM bet_pools;

DROP TABLE bet_pools;
ALTER TABLE bet_pools_v2 RENAME TO bet_pools;
