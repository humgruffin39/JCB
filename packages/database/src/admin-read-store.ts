import type Database from 'better-sqlite3';

type StringRow = Record<string, string | null>;
type AdminRow = Record<string, string | number | null>;

export class SqliteAdminReadStore {
  public constructor(private readonly database: Database.Database) {}

  public listLedger(limit = 200): readonly StringRow[] {
    const boundedLimit = Math.min(500, Math.max(1, limit));
    return (
      this.database
        .prepare(
          `SELECT le.id, le.transaction_id AS transactionId, lt.kind,
                  lt.reference_type AS referenceType, lt.reference_id AS referenceId,
                  le.account_id AS accountId, le.amount, le.created_at AS createdAt
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           ORDER BY le.created_at DESC, le.id DESC LIMIT ?`,
        )
        .all(boundedLimit) as Array<Record<string, bigint | string | null>>
    ).map(stringifyRow);
  }

  public horsePerformance(horseId: string): {
    readonly starts: number;
    readonly wins: number;
    readonly topThreeFinishes: number;
    readonly history: readonly AdminRow[];
  } {
    const history = (
      this.database
        .prepare(
          `SELECT r.id AS raceId, r.race_date AS raceDate, r.name AS raceName,
                  r.kind, r.distance_m AS distanceM, r.surface, r.status,
                  re.horse_number AS horseNumber, re.condition,
                  re.finish_position AS finishPosition, re.finish_time_ms AS finishTimeMs
           FROM race_entries re
           JOIN races r ON r.id = re.race_id
           WHERE re.horse_id = ?
           ORDER BY r.scheduled_at DESC`,
        )
        .all(horseId) as Record<string, unknown>[]
    ).map(normalizeRow) as AdminRow[];
    return {
      starts: history.length,
      wins: history.filter((row) => row.finishPosition === 1 || row.finishPosition === '1').length,
      topThreeFinishes: history.filter(
        (row) =>
          row.finishPosition !== null &&
          row.finishPosition !== undefined &&
          Number(row.finishPosition) <= 3,
      ).length,
      history,
    };
  }

  public listRaceOperations(limit = 500): readonly AdminRow[] {
    const boundedLimit = Math.min(500, Math.max(1, limit));
    return (
      this.database
        .prepare(
          `SELECT r.id, r.race_date AS raceDate, r.name, r.kind, r.status, r.version,
                  r.distance_m AS distanceM, r.surface,
                  r.scheduled_at AS scheduledAt, r.betting_opens_at AS bettingOpensAt,
                  r.betting_closes_at AS bettingClosesAt,
                  r.viewer_opens_at AS viewerOpensAt,
                  r.simulation_version AS simulationVersion,
                  r.odds_version AS oddsVersion,
                  r.timeline_duration_ms AS timelineDurationMs,
                  r.seed_liquidity_diagnostics_json AS seedLiquidityDiagnosticsJson,
                  CASE WHEN r.status = 'draft'
                    THEN (SELECT json_group_array(json_object(
                      'horseId', red.horse_id, 'horseNumber', red.horse_number))
                      FROM race_entry_drafts red WHERE red.race_id = r.id)
                    ELSE (SELECT json_group_array(json_object(
                      'horseId', re.horse_id, 'horseNumber', re.horse_number,
                      'condition', re.condition))
                      FROM race_entries re WHERE re.race_id = r.id)
                  END AS entriesJson,
                  CASE WHEN r.final_odds_json IS NULL THEN 0 ELSE 1 END AS finalOddsReady,
                  (SELECT status FROM race_simulations rs
                   WHERE rs.race_id = r.id AND rs.race_version = r.version
                     AND rs.kind = 'official') AS officialSimulationStatus,
                  (SELECT completed_at FROM race_simulations rs
                   WHERE rs.race_id = r.id AND rs.race_version = r.version
                     AND rs.kind = 'official') AS officialSimulationCompletedAt,
                  (SELECT status FROM race_simulations rs
                   WHERE rs.race_id = r.id AND rs.race_version = r.version
                     AND rs.kind = 'odds') AS oddsSimulationStatus,
                  (SELECT COUNT(*) FROM odds_probabilities op
                   WHERE op.race_id = r.id) AS oddsSelectionCount,
                  (SELECT MIN(base_odds) FROM odds_probabilities op
                   WHERE op.race_id = r.id) AS minimumBaseOdds,
                  (SELECT MAX(base_odds) FROM odds_probabilities op
                   WHERE op.race_id = r.id) AS maximumBaseOdds,
                  (SELECT COALESCE(SUM(seed_liquidity), 0) FROM bet_pools bp
                   WHERE bp.race_id = r.id) AS seedLiquidity,
                  (SELECT timeline_object_key FROM race_simulations rs
                   WHERE rs.race_id = r.id AND rs.race_version = r.version
                     AND rs.kind = 'official') AS timelineObjectKey,
                  (SELECT timeline_sha256 FROM race_simulations rs
                   WHERE rs.race_id = r.id AND rs.race_version = r.version
                     AND rs.kind = 'official') AS timelineSha256
           FROM races r ORDER BY r.scheduled_at DESC LIMIT ?`,
        )
        .all(boundedLimit) as Record<string, unknown>[]
    ).map(normalizeRow) as AdminRow[];
  }

  public economyOperations(limit = 300): {
    readonly accounts: readonly AdminRow[];
    readonly bets: readonly AdminRow[];
    readonly settlements: readonly AdminRow[];
    readonly carryover: AdminRow | null;
    readonly seedPositions: readonly AdminRow[];
    readonly relief: readonly AdminRow[];
  } {
    const boundedLimit = Math.min(500, Math.max(1, limit));
    const rows = (sql: string, ...parameters: unknown[]) =>
      (this.database.prepare(sql).all(...parameters) as Record<string, unknown>[]).map(
        normalizeRow,
      ) as AdminRow[];
    const carryover = this.database
      .prepare(
        `SELECT tc.account_id AS accountId, tc.amount_projection AS amountProjection,
                ab.amount AS accountBalance, tc.updated_at AS updatedAt
         FROM trifecta_carryover tc
         JOIN account_balances ab ON ab.account_id = tc.account_id
         WHERE tc.id = 'global'`,
      )
      .get() as Record<string, unknown> | undefined;
    return {
      accounts: rows(
        `SELECT a.id, a.owner_type AS ownerType, a.owner_key AS ownerKey,
                a.account_type AS accountType, a.currency, ab.amount,
                u.display_name AS displayName, a.created_at AS createdAt
         FROM accounts a JOIN account_balances ab ON ab.account_id = a.id
         LEFT JOIN users u ON a.account_type = 'user' AND u.id = a.owner_key
         ORDER BY a.account_type, COALESCE(u.display_name, a.owner_key) LIMIT ?`,
        boundedLimit,
      ),
      bets: rows(
        `SELECT b.id, r.race_date AS raceDate, r.name AS raceName,
                u.display_name AS displayName, bp.pool_type AS poolType,
                b.selection_code AS selectionCode, b.stake, b.status, b.payout,
                b.created_at AS createdAt, b.settled_at AS settledAt
         FROM bets b JOIN users u ON u.id = b.user_id
         JOIN bet_pools bp ON bp.id = b.pool_id
         JOIN races r ON r.id = bp.race_id
         ORDER BY b.created_at DESC LIMIT ?`,
        boundedLimit,
      ),
      settlements: rows(
        `SELECT lt.id, lt.kind, lt.reference_type AS referenceType,
                lt.reference_id AS referenceId, lt.description,
                lt.created_at AS createdAt
         FROM ledger_transactions lt
         WHERE lt.kind IN ('pool_settlement', 'bet_refund', 'seed_refund')
         ORDER BY lt.created_at DESC LIMIT ?`,
        boundedLimit,
      ),
      carryover: carryover === undefined ? null : (normalizeRow(carryover) as AdminRow),
      seedPositions: rows(
        `SELECT r.race_date AS raceDate, r.name AS raceName,
                bp.pool_type AS poolType, sp.selection_code AS selectionCode,
                sp.stake, sp.payout,
                CASE WHEN sp.payout IS NULL THEN NULL ELSE sp.payout - sp.stake END AS profitLoss
         FROM seed_positions sp JOIN bet_pools bp ON bp.id = sp.pool_id
         JOIN races r ON r.id = bp.race_id
         ORDER BY r.scheduled_at DESC, bp.pool_type, sp.selection_code LIMIT ?`,
        boundedLimit,
      ),
      relief: rows(
        `SELECT lt.id AS transactionId, u.display_name AS displayName,
                le.amount, lt.reference_id AS userId, lt.created_at AS createdAt
         FROM ledger_transactions lt
         JOIN ledger_entries le ON le.transaction_id = lt.id AND le.amount > 0
         JOIN accounts a ON a.id = le.account_id AND a.account_type = 'user'
         JOIN users u ON u.id = a.owner_key
         WHERE lt.kind = 'relief'
         ORDER BY lt.created_at DESC LIMIT ?`,
        boundedLimit,
      ),
    };
  }

  public systemObjects(limit = 500): {
    readonly discordMessages: readonly AdminRow[];
    readonly timelineObjects: readonly AdminRow[];
    readonly objectPublications: readonly AdminRow[];
  } {
    const boundedLimit = Math.min(500, Math.max(1, limit));
    const rows = (sql: string) =>
      (this.database.prepare(sql).all(boundedLimit) as Record<string, unknown>[]).map(
        normalizeRow,
      ) as AdminRow[];
    return {
      discordMessages: rows(
        `SELECT dm.id, dm.purpose, dm.race_id AS raceId, r.name AS raceName,
                dm.channel_id AS channelId, dm.message_id AS messageId,
                dm.updated_at AS updatedAt
         FROM discord_messages dm LEFT JOIN races r ON r.id = dm.race_id
         ORDER BY dm.updated_at DESC LIMIT ?`,
      ),
      timelineObjects: rows(
        `SELECT rs.race_id AS raceId, r.name AS raceName,
                rs.race_version AS raceVersion, rs.status,
                rs.timeline_object_key AS objectKey,
                rs.timeline_sha256 AS sha256, rs.completed_at AS completedAt
         FROM race_simulations rs JOIN races r ON r.id = rs.race_id
         WHERE rs.kind = 'official' AND rs.timeline_object_key IS NOT NULL
         ORDER BY rs.completed_at DESC LIMIT ?`,
      ),
      objectPublications: rows(
        `SELECT id, object_key AS objectKey, status,
                attempt_count AS attemptCount, next_attempt_at AS nextAttemptAt,
                last_error_redacted AS lastError, locked_at AS lockedAt,
                locked_by AS lockedBy, created_at AS createdAt, updated_at AS updatedAt
         FROM object_publications ORDER BY updated_at DESC LIMIT ?`,
      ),
    };
  }

  public listJobs(limit = 200): readonly StringRow[] {
    return (
      this.database
        .prepare(
          `SELECT id, job_type AS jobType, deduplication_key AS deduplicationKey,
                  run_at AS runAt, status, attempt_count AS attemptCount,
                  locked_at AS lockedAt, locked_by AS lockedBy,
                  last_error_code AS lastErrorCode,
                  last_error_redacted AS lastErrorRedacted, updated_at AS updatedAt
           FROM scheduled_jobs ORDER BY run_at DESC LIMIT ?`,
        )
        .all(Math.min(500, Math.max(1, limit))) as Array<Record<string, bigint | string | null>>
    ).map(stringifyRow);
  }

  public listAudit(limit = 200): readonly StringRow[] {
    return (
      this.database
        .prepare(
          `SELECT id, actor_user_id AS actorUserId, action, target_type AS targetType,
                  target_id AS targetId, reason, before_json AS beforeJson,
                  after_json AS afterJson, ip_hash AS ipHash, created_at AS createdAt
           FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(Math.min(500, Math.max(1, limit))) as Array<Record<string, bigint | string | null>>
    ).map(stringifyRow);
  }

  public listAdministrators(): readonly {
    readonly discordUserId: string;
    readonly createdAt: string;
  }[] {
    const rows = this.database
      .prepare(
        `SELECT discord_user_id AS discordUserId, created_at AS createdAt
         FROM admin_allowlist ORDER BY created_at, discord_user_id`,
      )
      .all() as { discordUserId: string; createdAt: bigint }[];
    return rows.map((row) => ({
      discordUserId: row.discordUserId,
      createdAt: row.createdAt.toString(),
    }));
  }

  public getSetting(key: string): unknown {
    const row = this.database
      .prepare('SELECT value_json AS valueJson FROM app_settings WHERE key = ?')
      .get(key) as { valueJson: string } | undefined;
    if (row === undefined) throw new Error(`Setting ${key} was not found.`);
    return JSON.parse(row.valueJson) as unknown;
  }

  public listSettingHistory(
    key: string,
    limit = 50,
  ): readonly {
    readonly id: string;
    readonly value: unknown;
    readonly updatedByUserId: string | null;
    readonly updatedAt: string;
  }[] {
    const rows = this.database
      .prepare(
        `SELECT id, value_json AS valueJson, updated_by_user_id AS updatedByUserId,
                updated_at AS updatedAt
         FROM setting_history WHERE key = ?
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(key, Math.min(200, Math.max(1, limit))) as {
      id: string;
      valueJson: string;
      updatedByUserId: string | null;
      updatedAt: bigint;
    }[];
    return rows.map((row) => ({
      id: row.id,
      value: JSON.parse(row.valueJson) as unknown,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt.toString(),
    }));
  }
}

function stringifyRow(row: Record<string, bigint | string | null>): StringRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value,
    ]),
  );
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value,
    ]),
  );
}
