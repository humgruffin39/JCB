import type Database from 'better-sqlite3';
import {
  decryptAesGcmWithKeys,
  deriveResultKey,
  encryptAesGcm,
  sha256,
  type EncryptedPayload,
  type RacePreparationCompletion,
  type RacePreparationRepository,
  type RacePreparationStart,
} from '@jcb/application';
import {
  identifier,
  timestamp,
  transitionRace,
  type Condition,
  type RaceEntry,
  type RaceKind,
  type RaceStatus,
} from '@jcb/domain';
import { ODDS_VERSION } from '@jcb/odds';
import { generateSimulationSeeds, PRNG_VERSION, SIMULATION_VERSION } from '@jcb/simulation';
import { ulid } from 'ulid';
import { SqliteGameStore } from './game-store.js';
import { SqliteObjectPublicationStore } from './object-publication-store.js';

interface RacePreparationRow {
  readonly id: string;
  readonly kind: RaceKind;
  readonly status: RaceStatus;
  readonly version: bigint;
  readonly distanceM: bigint;
  readonly surface: 'turf' | 'dirt';
  readonly scheduledAt: bigint;
  readonly inputHash: string;
  readonly simulationConfigJson: string;
}

interface EntryRow {
  readonly horseId: string;
  readonly horseNumber: bigint;
  readonly condition: Condition;
  readonly tieBreaker: number;
  readonly name: string;
  readonly runningStyle: 'front_runner' | 'closer';
  readonly speed: bigint;
  readonly start: bigint;
  readonly acceleration: bigint;
  readonly stamina: bigint;
  readonly lateKick: bigint;
  readonly conditionStability: bigint;
  readonly distancePreference: bigint;
  readonly surfacePreference: bigint;
}

export class SqliteRacePreparationRepository implements RacePreparationRepository {
  private readonly gameStore: SqliteGameStore;

  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
    resultMasterSecret: string | readonly string[],
  ) {
    this.resultMasterSecrets = normalizeMasterSecrets(resultMasterSecret);
    this.gameStore = new SqliteGameStore(database, now);
  }

  private readonly resultMasterSecrets: readonly string[];

  public begin(raceId: string): RacePreparationStart {
    const run = this.database.transaction((): RacePreparationStart => {
      const race = this.loadRace(raceId);
      if (race.status !== 'simulating') transitionRace(race.status, 'simulating');
      const entries = this.loadEntries(raceId);
      const simulationSettings = parseSimulationSettings(race.simulationConfigJson);
      const seeds = this.loadOrCreateSeeds(race);
      this.database
        .prepare(
          `UPDATE races SET status = 'simulating', simulation_version = ?,
           odds_version = ?, updated_at = ? WHERE id = ?`,
        )
        .run(SIMULATION_VERSION, ODDS_VERSION, BigInt(this.now()), raceId);
      return {
        raceId,
        raceVersion: Number(race.version),
        raceKind: race.kind,
        scheduledAt: timestamp(Number(race.scheduledAt)),
        input: {
          raceId,
          raceVersion: Number(race.version),
          distanceM: Number(race.distanceM),
          surface: race.surface,
          entries,
          noiseStandardDeviation: simulationSettings.noiseStandardDeviation,
          fatigueMaximum: simulationSettings.fatigueMaximum,
        },
        ...seeds,
      };
    });
    return run.immediate();
  }

  public complete(start: RacePreparationStart, completion: RacePreparationCompletion): void {
    const run = this.database.transaction(() => {
      const race = this.loadRace(start.raceId);
      if (race.status !== 'simulating' || Number(race.version) !== start.raceVersion) {
        throw new Error('Race changed during preparation.');
      }
      if (completion.official.inputHash !== race.inputHash) {
        throw new Error('Official simulation input hash does not match locked race input.');
      }
      const now = BigInt(this.now());
      this.database
        .prepare(
          `UPDATE race_simulations
           SET status = 'completed', result_hash = ?, encrypted_result_blob = ?,
               timeline_object_key = ?, timeline_sha256 = ?, completed_at = ?,
               error_code = NULL, error_detail_redacted = NULL
           WHERE race_id = ? AND race_version = ? AND kind = 'official'`,
        )
        .run(
          completion.official.resultHash,
          JSON.stringify(completion.encryptedResult),
          completion.timelineObjectKey,
          completion.timelineSha256,
          now,
          start.raceId,
          start.raceVersion,
        );
      const oddsHash = sha256(
        Buffer.from(
          JSON.stringify({
            oddsVersion: completion.probabilities.oddsVersion,
            simulationCount: completion.probabilities.simulationCount,
            win: completion.probabilities.win,
            trifecta: completion.probabilities.trifecta,
          }),
          'utf8',
        ),
      );
      this.database
        .prepare(
          `UPDATE race_simulations SET status = 'completed', result_hash = ?,
           completed_at = ?, error_code = NULL, error_detail_redacted = NULL
           WHERE race_id = ? AND race_version = ? AND kind = 'odds'`,
        )
        .run(oddsHash, now, start.raceId, start.raceVersion);
      this.database.prepare('DELETE FROM odds_probabilities WHERE race_id = ?').run(start.raceId);
      const insertOdds = this.database.prepare(
        `INSERT INTO odds_probabilities
         (id, race_id, pool_type, selection_code, model_probability, base_odds,
          seed_stake, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const winStake = new Map(
        completion.winPositions.map((position) => [position.selectionCode, position.stake]),
      );
      const trifectaStake = new Map(
        completion.trifectaPositions.map((position) => [position.selectionCode, position.stake]),
      );
      for (const selection of completion.probabilities.win) {
        insertOdds.run(
          ulid(),
          start.raceId,
          'win',
          selection.selectionCode,
          selection.modelProbability,
          selection.baseOdds,
          winStake.get(selection.selectionCode) ?? 0n,
          now,
        );
      }
      for (const selection of completion.probabilities.trifecta) {
        insertOdds.run(
          ulid(),
          start.raceId,
          'trifecta',
          selection.selectionCode,
          selection.modelProbability,
          selection.baseOdds,
          trifectaStake.get(selection.selectionCode) ?? 0n,
          now,
        );
      }
      this.database
        .prepare(
          `UPDATE races SET timeline_duration_ms = ?, updated_at = ?
           WHERE id = ? AND status = 'simulating'`,
        )
        .run(completion.official.timelineDurationMs, now, start.raceId);
      this.gameStore.openBettingPools({
        raceId: start.raceId,
        winLiquidity: completion.winLiquidity,
        trifectaLiquidity: completion.trifectaLiquidity,
        winPositions: completion.winPositions,
        trifectaPositions: completion.trifectaPositions,
      });
      const publications = new SqliteObjectPublicationStore(this.database);
      publications.enqueue(
        completion.timelineObjectKey,
        completion.timelineCiphertext,
        {
          raceId: start.raceId,
          sha256: completion.timelineSha256,
          codecVersion: 'json-gzip-v1',
        },
        Number(now),
      );
      publications.enqueue(
        `race-manifests/${start.raceId}.json`,
        Buffer.from(JSON.stringify(completion.signedManifest), 'utf8'),
        { raceId: start.raceId, type: 'release-manifest' },
        Number(now),
      );
    });
    run.immediate();
  }

  public fail(raceId: string, errorCode: string, redactedMessage: string): void {
    const run = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE race_simulations SET status = 'failed', error_code = ?,
           error_detail_redacted = ?, completed_at = ? WHERE race_id = ? AND status <> 'completed'`,
        )
        .run(errorCode.slice(0, 80), redactedMessage.slice(0, 300), BigInt(this.now()), raceId);
      this.database
        .prepare(
          `UPDATE races SET status = 'failed', updated_at = ?
           WHERE id = ? AND status = 'simulating'`,
        )
        .run(BigInt(this.now()), raceId);
    });
    run.immediate();
  }

  private loadRace(raceId: string): RacePreparationRow {
    const row = this.database
      .prepare(
        `SELECT id, kind, status, version, distance_m AS distanceM, surface,
                scheduled_at AS scheduledAt, input_hash AS inputHash,
                simulation_config_json AS simulationConfigJson
         FROM races WHERE id = ?`,
      )
      .get(raceId) as RacePreparationRow | undefined;
    if (row === undefined || row.inputHash === null) throw new Error('Locked race not found.');
    return row;
  }

  private loadEntries(raceId: string): readonly RaceEntry[] {
    const rows = this.database
      .prepare(
        `SELECT horse_id AS horseId, horse_number AS horseNumber, condition,
                tie_breaker AS tieBreaker, snapshot_name AS name,
                snapshot_running_style AS runningStyle, snapshot_speed AS speed,
                snapshot_start AS start, snapshot_acceleration AS acceleration,
                snapshot_stamina AS stamina, snapshot_late_kick AS lateKick,
                snapshot_condition_stability AS conditionStability,
                snapshot_distance_preference AS distancePreference,
                snapshot_surface_preference AS surfacePreference
         FROM race_entries WHERE race_id = ? ORDER BY horse_number`,
      )
      .all(raceId) as EntryRow[];
    return rows.map((row) => ({
      horseNumber: Number(row.horseNumber),
      condition: row.condition,
      tieBreaker: row.tieBreaker,
      horse: {
        horseId: identifier(row.horseId),
        name: row.name,
        runningStyle: row.runningStyle,
        speed: Number(row.speed),
        start: Number(row.start),
        acceleration: Number(row.acceleration),
        stamina: Number(row.stamina),
        lateKick: Number(row.lateKick),
        conditionStability: Number(row.conditionStability),
        distancePreference: Number(row.distancePreference),
        surfacePreference: Number(row.surfacePreference),
      },
    }));
  }

  private loadOrCreateSeeds(race: RacePreparationRow): {
    readonly officialSeed: string;
    readonly oddsSeed: string;
  } {
    const existing = this.database
      .prepare(
        `SELECT kind, status, seed_ciphertext AS seedCiphertext,
                simulation_version AS simulationVersion
         FROM race_simulations WHERE race_id = ? AND race_version = ?`,
      )
      .all(race.id, race.version) as Array<{
      kind: 'official' | 'odds';
      status: 'running' | 'completed' | 'failed';
      seedCiphertext: string;
      simulationVersion: string;
    }>;
    if (existing.length === 2) {
      try {
        const decrypted = new Map(
          existing.map((row) => {
            const payload = JSON.parse(row.seedCiphertext) as EncryptedPayload;
            const versionCandidates = [row.simulationVersion, SIMULATION_VERSION].filter(
              (version, index, versions) => versions.indexOf(version) === index,
            );
            const keys = this.resultMasterSecrets.flatMap((secret) =>
              versionCandidates.map((version) =>
                deriveResultKey(secret, race.id, version, Number(race.version)),
              ),
            );
            return [row.kind, Buffer.from(decryptAesGcmWithKeys(payload, keys)).toString('utf8')];
          }),
        );
        const officialSeed = decrypted.get('official');
        const oddsSeed = decrypted.get('odds');
        if (officialSeed === undefined || oddsSeed === undefined)
          throw new Error('Seed records invalid.');
        return { officialSeed, oddsSeed };
      } catch (error) {
        if (!existing.every((row) => row.status === 'failed')) throw error;
      }
    }
    const seeds = generateSimulationSeeds();
    const insert = this.database.prepare(
      `INSERT INTO race_simulations
       (id, race_id, race_version, kind, status, seed_ciphertext, prng_version,
        simulation_version, input_hash, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
       ON CONFLICT(race_id, race_version, kind) DO UPDATE SET
         status = 'running', seed_ciphertext = excluded.seed_ciphertext,
         prng_version = excluded.prng_version, simulation_version = excluded.simulation_version,
         input_hash = excluded.input_hash, started_at = excluded.started_at,
         error_code = NULL, error_detail_redacted = NULL`,
    );
    const officialKey = deriveResultKey(
      this.resultMasterSecrets[0]!,
      race.id,
      SIMULATION_VERSION,
      Number(race.version),
    );
    const oddsKey = deriveResultKey(
      this.resultMasterSecrets[0]!,
      race.id,
      ODDS_VERSION,
      Number(race.version),
    );
    insert.run(
      ulid(),
      race.id,
      race.version,
      'official',
      JSON.stringify(encryptAesGcm(Buffer.from(seeds.officialSeed, 'utf8'), officialKey)),
      PRNG_VERSION,
      SIMULATION_VERSION,
      race.inputHash,
      BigInt(this.now()),
    );
    insert.run(
      ulid(),
      race.id,
      race.version,
      'odds',
      JSON.stringify(encryptAesGcm(Buffer.from(seeds.oddsSeed, 'utf8'), oddsKey)),
      PRNG_VERSION,
      ODDS_VERSION,
      race.inputHash,
      BigInt(this.now()),
    );
    return seeds;
  }
}

function normalizeMasterSecrets(value: string | readonly string[]): readonly string[] {
  const secrets = typeof value === 'string' ? [value] : [...value];
  if (secrets.length === 0 || secrets.some((secret) => secret.length === 0)) {
    throw new Error('At least one result master secret is required.');
  }
  return [...new Set(secrets)];
}

function parseSimulationSettings(value: string): {
  readonly noiseStandardDeviation: number;
  readonly fatigueMaximum: number;
} {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('noiseStandardDeviation' in parsed) ||
    typeof parsed.noiseStandardDeviation !== 'number' ||
    !('fatigueMaximum' in parsed) ||
    typeof parsed.fatigueMaximum !== 'number'
  ) {
    throw new Error('Race simulation settings snapshot is invalid.');
  }
  return {
    noiseStandardDeviation: parsed.noiseStandardDeviation,
    fatigueMaximum: parsed.fatigueMaximum,
  };
}
