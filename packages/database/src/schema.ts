import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) => integer(name, { mode: 'number' }).notNull();
const nullableTimestamp = (name: string) => integer(name, { mode: 'number' });
const sqliteBigInt = customType<{ data: bigint; driverData: bigint }>({
  dataType() {
    return 'integer';
  },
});
const amount = (name: string) => sqliteBigInt(name).notNull();

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    lastGuildCheckAt: timestamp('last_guild_check_at'),
  },
  (table) => [uniqueIndex('users_discord_user_id_unique').on(table.discordUserId)],
);

export const adminAllowlist = sqliteTable(
  'admin_allowlist',
  {
    discordUserId: text('discord_user_id').primaryKey(),
    addedByUserId: text('added_by_user_id'),
    createdAt: timestamp('created_at'),
  },
  (table) => [index('admin_allowlist_added_by_idx').on(table.addedByUserId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerKey: text('owner_key').notNull(),
    accountType: text('account_type', {
      enum: [
        'central_bank',
        'user',
        'race_win_pool',
        'race_trifecta_pool',
        'trifecta_carryover',
        'issuance',
        'burn',
      ],
    }).notNull(),
    currency: text('currency').notNull().default('RUP'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('accounts_owner_unique').on(table.currency, table.accountType, table.ownerKey),
  ],
);

export const ledgerTransactions = sqliteTable(
  'ledger_transactions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    description: text('description').notNull(),
    createdByUserId: text('created_by_user_id'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('ledger_transactions_idempotency_unique').on(table.idempotencyKey),
    index('ledger_transactions_reference_idx').on(table.referenceType, table.referenceId),
  ],
);

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: amount('amount'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    index('ledger_entries_account_created_idx').on(table.accountId, table.createdAt),
    index('ledger_entries_transaction_idx').on(table.transactionId),
    check('ledger_entries_non_zero', sql`${table.amount} <> 0`),
  ],
);

export const accountBalances = sqliteTable('account_balances', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  amount: amount('amount'),
  updatedAt: timestamp('updated_at'),
});

export const horses = sqliteTable(
  'horses',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'resting', 'retired'] }).notNull(),
    runningStyle: text('running_style', { enum: ['front_runner', 'closer'] }).notNull(),
    coatColor: text('coat_color', {
      enum: ['black', 'chestnut', 'gray', 'cream'],
    }).notNull(),
    speed: integer('speed').notNull(),
    start: integer('start').notNull(),
    acceleration: integer('acceleration').notNull(),
    stamina: integer('stamina').notNull(),
    lateKick: integer('late_kick').notNull(),
    conditionStability: integer('condition_stability').notNull(),
    distancePreference: integer('distance_preference').notNull(),
    surfacePreference: integer('surface_preference').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    retiredAt: nullableTimestamp('retired_at'),
  },
  (table) => [
    uniqueIndex('horses_name_unique').on(table.name),
    ...[
      table.speed,
      table.start,
      table.acceleration,
      table.stamina,
      table.lateKick,
      table.conditionStability,
    ].map((column, indexValue) =>
      check(`horses_ability_${indexValue}_range`, sql`${column} BETWEEN 0 AND 100`),
    ),
  ],
);

export const races = sqliteTable(
  'races',
  {
    id: text('id').primaryKey(),
    raceDate: text('race_date').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['regular', 'midweek', 'saturday_night'] }).notNull(),
    status: text('status', {
      enum: [
        'draft',
        'locked',
        'simulating',
        'betting_open',
        'betting_closed',
        'ready',
        'running',
        'finished',
        'settling',
        'settled',
        'cancelled',
        'failed',
      ],
    }).notNull(),
    version: integer('version').notNull().default(0),
    distanceM: integer('distance_m').notNull(),
    surface: text('surface', { enum: ['turf', 'dirt'] }).notNull(),
    scheduledAt: timestamp('scheduled_at'),
    bettingOpensAt: timestamp('betting_opens_at'),
    bettingClosesAt: timestamp('betting_closes_at'),
    viewerOpensAt: timestamp('viewer_opens_at'),
    inputHash: text('input_hash'),
    simulationConfigJson: text('simulation_config_json')
      .notNull()
      .default('{"noiseStandardDeviation":0.022,"fatigueMaximum":0.12}'),
    simulationVersion: text('simulation_version'),
    oddsVersion: text('odds_version'),
    timelineDurationMs: integer('timeline_duration_ms'),
    finalOddsJson: text('final_odds_json'),
    seedLiquidityDiagnosticsJson: text('seed_liquidity_diagnostics_json'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    cancelledAt: nullableTimestamp('cancelled_at'),
    cancelReason: text('cancel_reason'),
  },
  (table) => [
    uniqueIndex('races_race_date_unique').on(table.raceDate),
    check('races_distance_positive', sql`${table.distanceM} > 0`),
    check('races_version_non_negative', sql`${table.version} >= 0`),
  ],
);

export const raceEntryDrafts = sqliteTable(
  'race_entry_drafts',
  {
    id: text('id').primaryKey(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    horseId: text('horse_id')
      .notNull()
      .references(() => horses.id),
    horseNumber: integer('horse_number').notNull(),
  },
  (table) => [
    uniqueIndex('race_entry_drafts_number_unique').on(table.raceId, table.horseNumber),
    uniqueIndex('race_entry_drafts_horse_unique').on(table.raceId, table.horseId),
    check('race_entry_drafts_number_range', sql`${table.horseNumber} BETWEEN 1 AND 8`),
  ],
);

export const raceEntries = sqliteTable(
  'race_entries',
  {
    id: text('id').primaryKey(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    horseId: text('horse_id')
      .notNull()
      .references(() => horses.id),
    horseNumber: integer('horse_number').notNull(),
    condition: text('condition', {
      enum: ['terrible', 'poor', 'normal', 'good', 'excellent'],
    }).notNull(),
    tieBreaker: real('tie_breaker').notNull(),
    snapshotName: text('snapshot_name').notNull(),
    snapshotRunningStyle: text('snapshot_running_style', {
      enum: ['front_runner', 'closer'],
    }).notNull(),
    snapshotSpeed: integer('snapshot_speed').notNull(),
    snapshotStart: integer('snapshot_start').notNull(),
    snapshotAcceleration: integer('snapshot_acceleration').notNull(),
    snapshotStamina: integer('snapshot_stamina').notNull(),
    snapshotLateKick: integer('snapshot_late_kick').notNull(),
    snapshotConditionStability: integer('snapshot_condition_stability').notNull(),
    snapshotDistancePreference: integer('snapshot_distance_preference').notNull(),
    snapshotSurfacePreference: integer('snapshot_surface_preference').notNull(),
    finishPosition: integer('finish_position'),
    finishTimeMs: integer('finish_time_ms'),
  },
  (table) => [
    uniqueIndex('race_entries_number_unique').on(table.raceId, table.horseNumber),
    uniqueIndex('race_entries_horse_unique').on(table.raceId, table.horseId),
    check('race_entries_horse_number_range', sql`${table.horseNumber} BETWEEN 1 AND 8`),
    check(
      'race_entries_tie_breaker_range',
      sql`${table.tieBreaker} >= 0 AND ${table.tieBreaker} < 1`,
    ),
  ],
);

export const raceSimulations = sqliteTable(
  'race_simulations',
  {
    id: text('id').primaryKey(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    raceVersion: integer('race_version').notNull(),
    kind: text('kind', { enum: ['odds', 'official'] }).notNull(),
    status: text('status').notNull(),
    seedCiphertext: text('seed_ciphertext').notNull(),
    prngVersion: text('prng_version').notNull(),
    simulationVersion: text('simulation_version').notNull(),
    inputHash: text('input_hash').notNull(),
    resultHash: text('result_hash'),
    encryptedResultBlob: text('encrypted_result_blob'),
    timelineObjectKey: text('timeline_object_key'),
    timelineSha256: text('timeline_sha256'),
    startedAt: timestamp('started_at'),
    completedAt: nullableTimestamp('completed_at'),
    errorCode: text('error_code'),
    errorDetailRedacted: text('error_detail_redacted'),
  },
  (table) => [
    uniqueIndex('race_simulations_unique').on(table.raceId, table.raceVersion, table.kind),
  ],
);

export const oddsProbabilities = sqliteTable(
  'odds_probabilities',
  {
    id: text('id').primaryKey(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    poolType: text('pool_type', { enum: ['win', 'trifecta'] }).notNull(),
    selectionCode: text('selection_code').notNull(),
    modelProbability: real('model_probability').notNull(),
    baseOdds: real('base_odds').notNull(),
    seedStake: amount('seed_stake'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('odds_probabilities_unique').on(table.raceId, table.poolType, table.selectionCode),
    check('odds_probabilities_positive', sql`${table.modelProbability} > 0`),
  ],
);

export const betPools = sqliteTable(
  'bet_pools',
  {
    id: text('id').primaryKey(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    poolType: text('pool_type', { enum: ['win', 'trifecta'] }).notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    seedLiquidity: amount('seed_liquidity'),
    userStakeTotal: amount('user_stake_total').default(0n),
    finalizedAt: nullableTimestamp('finalized_at'),
    status: text('status').notNull(),
  },
  (table) => [uniqueIndex('bet_pools_unique').on(table.raceId, table.poolType)],
);

export const seedPositions = sqliteTable(
  'seed_positions',
  {
    id: text('id').primaryKey(),
    poolId: text('pool_id')
      .notNull()
      .references(() => betPools.id),
    selectionCode: text('selection_code').notNull(),
    stake: amount('stake'),
    payout: sqliteBigInt('payout'),
    createdAt: timestamp('created_at'),
  },
  (table) => [uniqueIndex('seed_positions_unique').on(table.poolId, table.selectionCode)],
);

export const bets = sqliteTable(
  'bets',
  {
    id: text('id').primaryKey(),
    poolId: text('pool_id')
      .notNull()
      .references(() => betPools.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    selectionCode: text('selection_code').notNull(),
    stake: amount('stake'),
    status: text('status', { enum: ['open', 'won', 'lost', 'refunded'] }).notNull(),
    payout: amount('payout').default(0n),
    interactionId: text('interaction_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at'),
    settledAt: nullableTimestamp('settled_at'),
  },
  (table) => [
    uniqueIndex('bets_idempotency_unique').on(table.idempotencyKey),
    index('bets_pool_selection_idx').on(table.poolId, table.selectionCode),
    index('bets_user_idx').on(table.userId, table.createdAt),
  ],
);

export const trifectaCarryover = sqliteTable(
  'trifecta_carryover',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id),
    amountProjection: amount('amount_projection'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [check('trifecta_carryover_singleton', sql`${table.id} = 'global'`)],
);

export const interactionSessions = sqliteTable(
  'interaction_sessions',
  {
    id: text('id').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    raceId: text('race_id')
      .notNull()
      .references(() => races.id),
    raceVersion: integer('race_version').notNull(),
    step: text('step').notNull(),
    payloadJson: text('payload_json').notNull(),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('interaction_sessions_expiry_idx').on(table.expiresAt)],
);

export const webLoginTickets = sqliteTable(
  'web_login_tickets',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    discordUserId: text('discord_user_id').notNull(),
    raceId: text('race_id').references(() => races.id),
    expiresAt: timestamp('expires_at'),
    consumedAt: nullableTimestamp('consumed_at'),
    createdAt: timestamp('created_at'),
  },
  (table) => [uniqueIndex('web_login_tickets_hash_unique').on(table.tokenHash)],
);

export const webSessions = sqliteTable(
  'web_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    discordUserId: text('discord_user_id').notNull(),
    authMethod: text('auth_method', {
      enum: ['ticket', 'discord_oauth'],
    })
      .notNull()
      .default('ticket'),
    expiresAt: timestamp('expires_at'),
    lastGuildCheckAt: timestamp('last_guild_check_at'),
    revokedAt: nullableTimestamp('revoked_at'),
    reauthenticatedAt: nullableTimestamp('reauthenticated_at'),
    createdAt: timestamp('created_at'),
  },
  (table) => [uniqueIndex('web_sessions_hash_unique').on(table.tokenHash)],
);

export const oauthLoginStates = sqliteTable(
  'oauth_login_states',
  {
    id: text('id').primaryKey(),
    stateHash: text('state_hash').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    expiresAt: timestamp('expires_at'),
    consumedAt: nullableTimestamp('consumed_at'),
    purpose: text('purpose', {
      enum: ['login', 'emergency_reauthentication'],
    })
      .notNull()
      .default('login'),
    existingSessionId: text('existing_session_id'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('oauth_login_states_hash_unique').on(table.stateHash),
    index('oauth_login_states_expiry_idx').on(table.expiresAt),
  ],
);

export const scheduledJobs = sqliteTable(
  'scheduled_jobs',
  {
    id: text('id').primaryKey(),
    jobType: text('job_type').notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    payloadJson: text('payload_json').notNull(),
    runAt: timestamp('run_at'),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'retry_wait', 'dead_letter'],
    }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lockedAt: nullableTimestamp('locked_at'),
    lockedBy: text('locked_by'),
    lastErrorCode: text('last_error_code'),
    lastErrorRedacted: text('last_error_redacted'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    uniqueIndex('scheduled_jobs_dedup_unique').on(table.deduplicationKey),
    index('scheduled_jobs_due_idx').on(table.status, table.runAt),
  ],
);

export const discordMessages = sqliteTable(
  'discord_messages',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull(),
    raceId: text('race_id').references(() => races.id),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [uniqueIndex('discord_messages_unique').on(table.purpose, table.raceId)],
);

export const rankingSnapshots = sqliteTable('ranking_snapshots', {
  id: text('id').primaryKey(),
  calculatedAt: timestamp('calculated_at'),
  payloadJson: text('payload_json').notNull(),
  sourceLedgerTransactionId: text('source_ledger_transaction_id').references(
    () => ledgerTransactions.id,
  ),
});

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at'),
  },
  (table) => [index('audit_logs_target_idx').on(table.targetType, table.targetId, table.createdAt)],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedByUserId: text('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at'),
});

export const settingHistory = sqliteTable(
  'setting_history',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    updatedByUserId: text('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('setting_history_key_idx').on(table.key, table.updatedAt)],
);

export const idempotencyRecords = sqliteTable('idempotency_records', {
  key: text('key').primaryKey(),
  operation: text('operation').notNull(),
  resultReferenceId: text('result_reference_id'),
  createdAt: timestamp('created_at'),
});

export const healthProbes = sqliteTable('health_probes', {
  id: text('id').primaryKey(),
  nonce: text('nonce').notNull(),
  updatedAt: timestamp('updated_at'),
});
