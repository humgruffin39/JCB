import type Database from 'better-sqlite3';
import {
  identifier,
  raceKindForJstDate,
  timestamp,
  transitionRace,
  type RaceEntry,
} from '@jcb/domain';
import { hashSimulationInput } from '@jcb/simulation';
import { ulid } from 'ulid';
import {
  DEFAULT_RACE_BET_LIMITS,
  DEFAULT_RACE_LOCK_SETTINGS,
  DEFAULT_SEED_LIQUIDITY_CLAMP,
  legacyAptitudes,
  mapRace,
  selectCondition,
  type RaceDraftInput,
  type RaceDraftPatch,
  type RaceLockSettings,
  type RaceRecord,
  type RaceRow,
} from './game-store-types.js';

interface RaceDraftHorseRow {
  readonly id: string;
  readonly name: string;
  readonly horseNumber: bigint;
  readonly running_style: 'front_runner' | 'closer';
  readonly speed: bigint;
  readonly start: bigint;
  readonly acceleration: bigint;
  readonly stamina: bigint;
  readonly condition_stability: bigint;
  readonly late_kick: bigint;
  readonly distance_preference: bigint;
  readonly surface_preference: bigint;
}

export class SqliteRaceStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public createRaceDraft(input: RaceDraftInput): RaceRecord {
    if (input.entries.length !== 8) throw new Error('Eight entries are required.');
    const id = ulid();
    const now = BigInt(this.now());
    const run = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO races
           (id, race_date, name, kind, status, version, distance_m, going, surface, scheduled_at,
            betting_opens_at, betting_closes_at, viewer_opens_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', 0, ?, 'firm', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.raceDate,
          input.name,
          input.kind ?? raceKindForJstDate(input.raceDate),
          input.distanceM,
          input.surface,
          BigInt(input.scheduledAt),
          BigInt(input.bettingOpensAt),
          BigInt(input.bettingClosesAt),
          BigInt(input.viewerOpensAt),
          now,
          now,
        );
      const insertEntry = this.database.prepare(
        `INSERT INTO race_entry_drafts (id, race_id, horse_id, horse_number)
         VALUES (?, ?, ?, ?)`,
      );
      for (const entry of input.entries) {
        insertEntry.run(ulid(), id, entry.horseId, entry.horseNumber);
      }
    });
    run.immediate();
    return this.getRace(id);
  }

  public listRaces(): readonly RaceRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, race_date AS raceDate, name, kind, status, version,
                  distance_m AS distanceM, surface, scheduled_at AS scheduledAt,
                  betting_opens_at AS bettingOpensAt, betting_closes_at AS bettingClosesAt,
                  viewer_opens_at AS viewerOpensAt, input_hash AS inputHash
           FROM races ORDER BY scheduled_at DESC`,
        )
        .all() as RaceRow[]
    ).map(mapRace);
  }

  public updateRaceDraft(raceId: string, patch: RaceDraftPatch): RaceRecord {
    const run = this.database.transaction(() => {
      const current = this.getRace(raceId);
      if (current.status !== 'draft') throw new Error('Only draft races can be edited.');
      const next = {
        raceDate: patch.raceDate ?? current.raceDate,
        name: patch.name ?? current.name,
        kind: patch.kind ?? current.kind,
        distanceM: patch.distanceM ?? current.distanceM,
        surface: patch.surface ?? current.surface,
        scheduledAt: patch.scheduledAt ?? current.scheduledAt,
        bettingOpensAt: patch.bettingOpensAt ?? current.bettingOpensAt,
        bettingClosesAt: patch.bettingClosesAt ?? current.bettingClosesAt,
        viewerOpensAt: patch.viewerOpensAt ?? current.viewerOpensAt,
      };
      if (
        next.bettingOpensAt >= next.bettingClosesAt ||
        next.bettingClosesAt > next.scheduledAt ||
        next.viewerOpensAt > next.scheduledAt
      ) {
        throw new Error('Race schedule ordering is invalid.');
      }
      this.database
        .prepare(
          `UPDATE races SET race_date = ?, name = ?, kind = ?, distance_m = ?, surface = ?,
           scheduled_at = ?, betting_opens_at = ?, betting_closes_at = ?,
           viewer_opens_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
        )
        .run(
          next.raceDate,
          next.name,
          next.kind,
          next.distanceM,
          next.surface,
          BigInt(next.scheduledAt),
          BigInt(next.bettingOpensAt),
          BigInt(next.bettingClosesAt),
          BigInt(next.viewerOpensAt),
          BigInt(this.now()),
          raceId,
        );
      if (patch.entries !== undefined) {
        if (
          patch.entries.length !== 8 ||
          new Set(patch.entries.map((entry) => entry.horseId)).size !== 8 ||
          new Set(patch.entries.map((entry) => entry.horseNumber)).size !== 8
        ) {
          throw new Error('Eight distinct horses and numbers are required.');
        }
        this.database.prepare('DELETE FROM race_entry_drafts WHERE race_id = ?').run(raceId);
        const insert = this.database.prepare(
          'INSERT INTO race_entry_drafts (id, race_id, horse_id, horse_number) VALUES (?, ?, ?, ?)',
        );
        for (const entry of patch.entries) {
          insert.run(ulid(), raceId, entry.horseId, entry.horseNumber);
        }
      }
    });
    run.immediate();
    return this.getRace(raceId);
  }

  public getRace(id: string): RaceRecord {
    const row = this.database
      .prepare(
        `SELECT id, race_date AS raceDate, name, kind, status, version,
                distance_m AS distanceM, surface, scheduled_at AS scheduledAt,
                betting_opens_at AS bettingOpensAt, betting_closes_at AS bettingClosesAt,
                viewer_opens_at AS viewerOpensAt, input_hash AS inputHash
         FROM races WHERE id = ?`,
      )
      .get(id) as RaceRow | undefined;
    if (row === undefined) throw new Error('Race not found.');
    return mapRace(row);
  }

  public lockRace(
    raceId: string,
    randomUnit: () => number,
    settings: RaceLockSettings = DEFAULT_RACE_LOCK_SETTINGS,
  ): RaceRecord {
    const run = this.database.transaction(() => {
      const race = this.getRace(raceId);
      transitionRace(race.status, 'locked');
      const drafts = this.database
        .prepare(
          `SELECT red.horse_number AS horseNumber, h.*
           FROM race_entry_drafts red JOIN horses h ON h.id = red.horse_id
           WHERE red.race_id = ? ORDER BY red.horse_number`,
        )
        .all(raceId) as RaceDraftHorseRow[];
      if (drafts.length !== 8) throw new Error('Race must have eight available horses.');
      const insert = this.database.prepare(
        `INSERT INTO race_entries
         (id, race_id, horse_id, horse_number, condition, tie_breaker, snapshot_name,
          snapshot_running_style, snapshot_speed, snapshot_start, snapshot_acceleration,
          snapshot_stamina, snapshot_late_kick, snapshot_condition_stability,
          snapshot_aptitude_sprint, snapshot_aptitude_mile, snapshot_aptitude_middle,
          snapshot_aptitude_long, snapshot_aptitude_firm, snapshot_aptitude_good,
          snapshot_aptitude_heavy, snapshot_aptitude_turf, snapshot_aptitude_dirt,
          snapshot_distance_preference, snapshot_surface_preference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const snapshotForHash: RaceEntry[] = [];
      for (const draft of drafts) {
        const condition = selectCondition(randomUnit(), settings.conditionProbabilities);
        const tieBreaker = randomUnit();
        const legacy = legacyAptitudes(
          Number(draft.distance_preference),
          Number(draft.surface_preference),
        );
        insert.run(
          ulid(),
          raceId,
          draft.id,
          draft.horseNumber,
          condition,
          tieBreaker,
          draft.name,
          draft.running_style,
          draft.speed,
          draft.start,
          draft.acceleration,
          draft.stamina,
          draft.late_kick,
          draft.condition_stability,
          legacy.sprint,
          legacy.mile,
          legacy.middle,
          legacy.long,
          legacy.turf,
          legacy.dirt,
          legacy.dirt,
          legacy.turf,
          legacy.dirt,
          draft.distance_preference,
          draft.surface_preference,
        );
        snapshotForHash.push({
          horseNumber: Number(draft.horseNumber),
          condition,
          tieBreaker,
          horse: {
            horseId: identifier(draft.id),
            name: draft.name,
            runningStyle: draft.running_style,
            speed: Number(draft.speed),
            start: Number(draft.start),
            acceleration: Number(draft.acceleration),
            stamina: Number(draft.stamina),
            lateKick: Number(draft.late_kick),
            conditionStability: Number(draft.condition_stability),
            distancePreference: Number(draft.distance_preference),
            surfacePreference: Number(draft.surface_preference),
          },
        });
      }
      const inputHash = hashSimulationInput({
        raceId,
        raceVersion: race.version + 1,
        distanceM: race.distanceM,
        surface: race.surface,
        entries: snapshotForHash,
        noiseStandardDeviation: settings.simulationNoiseStandardDeviation,
        fatigueMaximum: settings.fatigueMaximum,
      });
      this.database
        .prepare(
          `UPDATE races SET status = 'locked', version = version + 1,
           input_hash = ?, simulation_config_json = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .run(
          inputHash,
          JSON.stringify({
            noiseStandardDeviation: settings.simulationNoiseStandardDeviation,
            fatigueMaximum: settings.fatigueMaximum,
            seedLiquidityClamp: settings.seedLiquidityClamp ?? DEFAULT_SEED_LIQUIDITY_CLAMP,
            raceBetLimits: settings.raceBetLimits ?? DEFAULT_RACE_BET_LIMITS,
          }),
          BigInt(this.now()),
          raceId,
        );
    });
    run.immediate();
    return this.getRace(raceId);
  }

  public unlockRace(raceId: string): RaceRecord {
    const run = this.database.transaction(() => {
      const race = this.getRace(raceId);
      transitionRace(race.status, 'draft');
      this.database.prepare('DELETE FROM race_entries WHERE race_id = ?').run(raceId);
      this.database
        .prepare(
          `UPDATE races SET status = 'draft', version = version + 1,
           input_hash = NULL, updated_at = ? WHERE id = ? AND status = 'locked'`,
        )
        .run(BigInt(this.now()), raceId);
    });
    run.immediate();
    return this.getRace(raceId);
  }
}
