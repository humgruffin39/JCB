import type Database from 'better-sqlite3';
import { identifier, timestamp, validateHorseSnapshot } from '@jcb/domain';
import { ulid } from 'ulid';
import {
  legacyAptitudes,
  mapHorse,
  type HorseRecord,
  type HorseRow,
  type HorseWrite,
} from './game-store-types.js';

export class SqliteHorseStore {
  public constructor(
    private readonly database: Database.Database,
    private readonly now: () => number,
  ) {}

  public createHorse(input: HorseWrite): HorseRecord {
    validateHorseSnapshot({ ...input, horseId: identifier('validation') });
    const id = ulid();
    const now = BigInt(this.now());
    const legacy = legacyAptitudes(input.distancePreference, input.surfacePreference);
    this.database
      .prepare(
        `INSERT INTO horses
         (id, name, status, running_style, coat_color, speed, start, acceleration, stamina, late_kick,
          condition_stability, aptitude_sprint, aptitude_mile, aptitude_middle, aptitude_long,
          aptitude_firm, aptitude_good, aptitude_heavy, aptitude_turf, aptitude_dirt,
          distance_preference, surface_preference,
          created_at, updated_at, retired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.status,
        input.runningStyle,
        input.coatColor ?? 'chestnut',
        input.speed,
        input.start,
        input.acceleration,
        input.stamina,
        input.lateKick,
        input.conditionStability,
        legacy.sprint,
        legacy.mile,
        legacy.middle,
        legacy.long,
        legacy.turf,
        legacy.dirt,
        legacy.dirt,
        legacy.turf,
        legacy.dirt,
        input.distancePreference,
        input.surfacePreference,
        now,
        now,
        input.status === 'retired' ? now : null,
      );
    return this.getHorse(id);
  }

  public listHorses(): readonly HorseRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, name, status, running_style AS runningStyle, coat_color AS coatColor, speed, start,
                  acceleration, stamina, late_kick AS lateKick,
                  condition_stability AS conditionStability,
                  distance_preference AS distancePreference,
                  surface_preference AS surfacePreference,
                  created_at AS createdAt,
                  updated_at AS updatedAt, retired_at AS retiredAt
           FROM horses ORDER BY name`,
        )
        .all() as HorseRow[]
    ).map(mapHorse);
  }

  public updateHorse(id: string, patch: Partial<HorseWrite>): HorseRecord {
    const current = this.getHorse(id);
    const merged: HorseWrite = {
      name: patch.name ?? current.name,
      status: patch.status ?? current.status,
      runningStyle: patch.runningStyle ?? current.runningStyle,
      coatColor: patch.coatColor ?? current.coatColor,
      speed: patch.speed ?? current.speed,
      start: patch.start ?? current.start,
      acceleration: patch.acceleration ?? current.acceleration,
      stamina: patch.stamina ?? current.stamina,
      lateKick: patch.lateKick ?? current.lateKick,
      conditionStability: patch.conditionStability ?? current.conditionStability,
      distancePreference: patch.distancePreference ?? current.distancePreference,
      surfacePreference: patch.surfacePreference ?? current.surfacePreference,
    };
    validateHorseSnapshot({ ...merged, horseId: identifier(id) });
    const now = BigInt(this.now());
    const legacy = legacyAptitudes(merged.distancePreference, merged.surfacePreference);
    this.database
      .prepare(
        `UPDATE horses SET name = ?, status = ?, running_style = ?, coat_color = ?, speed = ?, start = ?,
         acceleration = ?, stamina = ?, late_kick = ?, condition_stability = ?,
         aptitude_sprint = ?, aptitude_mile = ?, aptitude_middle = ?, aptitude_long = ?,
         aptitude_firm = ?, aptitude_good = ?, aptitude_heavy = ?,
         aptitude_turf = ?, aptitude_dirt = ?,
         distance_preference = ?, surface_preference = ?, updated_at = ?,
         retired_at = ? WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.status,
        merged.runningStyle,
        merged.coatColor,
        merged.speed,
        merged.start,
        merged.acceleration,
        merged.stamina,
        merged.lateKick,
        merged.conditionStability,
        legacy.sprint,
        legacy.mile,
        legacy.middle,
        legacy.long,
        legacy.turf,
        legacy.dirt,
        legacy.dirt,
        legacy.turf,
        legacy.dirt,
        merged.distancePreference,
        merged.surfacePreference,
        now,
        merged.status === 'retired' ? (current.retiredAt ?? timestamp(this.now())) : null,
        id,
      );
    return this.getHorse(id);
  }

  public getHorse(id: string): HorseRecord {
    const row = this.database
      .prepare(
        `SELECT id, name, status, running_style AS runningStyle, coat_color AS coatColor, speed, start,
                acceleration, stamina, late_kick AS lateKick,
                condition_stability AS conditionStability,
                distance_preference AS distancePreference,
                surface_preference AS surfacePreference,
                created_at AS createdAt,
                updated_at AS updatedAt, retired_at AS retiredAt
         FROM horses WHERE id = ?`,
      )
      .get(id) as HorseRow | undefined;
    if (row === undefined) throw new Error('Horse not found.');
    return mapHorse(row);
  }
}
