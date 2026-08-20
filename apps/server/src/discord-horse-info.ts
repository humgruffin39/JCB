import type { SqliteDatabase } from '@jcb/database';
import type { DiscordHorseInfoEntry, DiscordHorseInfoRace } from '@jcb/discord';
import type { RunningStyle, Surface } from '@jcb/domain';

interface RaceRow {
  readonly distanceM: bigint;
  readonly surface: Surface;
}

interface EntryRow {
  readonly horseNumber: bigint;
  readonly name: string;
  readonly runningStyle: RunningStyle;
  readonly speed: bigint;
  readonly start: bigint;
  readonly acceleration: bigint;
  readonly stamina: bigint;
  readonly lateKick: bigint;
  readonly conditionStability: bigint;
  readonly distancePreference: bigint;
  readonly surfacePreference: bigint;
}

export function readDiscordHorseInfo(
  database: SqliteDatabase,
  raceId: string,
): DiscordHorseInfoRace {
  const race = database
    .prepare(
      `SELECT distance_m AS distanceM, surface
       FROM races WHERE id = ?`,
    )
    .get(raceId) as RaceRow | undefined;
  if (race === undefined) throw new Error('Race not found.');

  const rows = database
    .prepare(
      `SELECT horse_number AS horseNumber, snapshot_name AS name,
              snapshot_running_style AS runningStyle, snapshot_speed AS speed,
              snapshot_start AS start, snapshot_acceleration AS acceleration,
              snapshot_stamina AS stamina, snapshot_late_kick AS lateKick,
              snapshot_condition_stability AS conditionStability,
              snapshot_distance_preference AS distancePreference,
              snapshot_surface_preference AS surfacePreference
       FROM race_entries WHERE race_id = ? ORDER BY horse_number`,
    )
    .all(raceId) as EntryRow[];
  if (rows.length !== 8) throw new Error('Race must have eight horse information entries.');

  return {
    distanceM: Number(race.distanceM),
    surface: race.surface,
    entries: rows.map((row): DiscordHorseInfoEntry => ({
      horseNumber: Number(row.horseNumber),
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
    })),
  };
}

export const getDiscordHorseInfo = readDiscordHorseInfo;

export function latestViewableRaceId(database: SqliteDatabase, now: number): string | undefined {
  const row = database
    .prepare(
      `SELECT id
       FROM races
       WHERE viewer_opens_at <= ?
         AND status NOT IN ('draft', 'locked', 'simulating', 'cancelled', 'failed')
       ORDER BY viewer_opens_at DESC, scheduled_at DESC, id DESC
       LIMIT 1`,
    )
    .get(BigInt(now)) as { id: string } | undefined;
  return row?.id;
}

export const getLatestViewableRaceId = latestViewableRaceId;

export interface DiscordRaceMessageReference {
  readonly raceId: string;
  readonly channelId: string;
  readonly messageId: string;
}

export function listDiscordRaceMessages(
  database: SqliteDatabase,
): readonly DiscordRaceMessageReference[] {
  return database
    .prepare(
      `SELECT race_id AS raceId, channel_id AS channelId, message_id AS messageId
       FROM discord_messages
       WHERE purpose = 'race' AND race_id IS NOT NULL
       ORDER BY race_id`,
    )
    .all() as DiscordRaceMessageReference[];
}
