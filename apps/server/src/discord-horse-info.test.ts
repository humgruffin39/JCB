import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, openDatabase, SqliteGameStore, type HorseWrite } from '@jcb/database';
import { timestamp } from '@jcb/domain';
import { describe, expect, it } from 'vitest';
import {
  latestViewableRaceId,
  listDiscordRaceMessages,
  readDiscordHorseInfo,
} from './discord-horse-info.js';

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'database',
  'migrations',
);

const horseBase: Omit<HorseWrite, 'name'> = {
  status: 'active',
  runningStyle: 'front_runner',
  speed: 20,
  start: 30,
  acceleration: 40,
  stamina: 50,
  lateKick: 60,
  conditionStability: 70,
  distancePreference: 80,
  surfacePreference: 90,
};

describe('Discord horse information read helper', () => {
  it('reads locked race snapshots instead of current horse abilities', () => {
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, 1);
    const game = new SqliteGameStore(database, () => 1);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({ ...horseBase, name: `スナップ馬${String(index + 1)}` }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-20',
      name: 'スナップ試験',
      distanceM: 1200,
      surface: 'turf',
      scheduledAt: timestamp(500),
      bettingOpensAt: timestamp(100),
      bettingClosesAt: timestamp(400),
      viewerOpensAt: timestamp(450),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);
    game.updateHorse(horses[0]!.id, {
      speed: 99,
      distancePreference: -100,
      surfacePreference: -100,
    });

    const result = readDiscordHorseInfo(database, race.id);
    expect(result.entries[0]).toMatchObject({
      speed: 20,
      distancePreference: 80,
      surfacePreference: 90,
    });
    expect(result.entries).toHaveLength(8);
    database.close();
  });

  it('returns only the newest race whose viewer has opened', () => {
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, 1);
    const game = new SqliteGameStore(database, () => 1);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({ ...horseBase, name: `最新馬${String(index + 1)}` }),
    );
    const createRace = (name: string, viewerOpensAt: number) => {
      const race = game.createRaceDraft({
        raceDate: '2026-08-20',
        name,
        distanceM: 1800,
        surface: 'dirt',
        scheduledAt: timestamp(viewerOpensAt + 50),
        bettingOpensAt: timestamp(viewerOpensAt - 100),
        bettingClosesAt: timestamp(viewerOpensAt + 20),
        viewerOpensAt: timestamp(viewerOpensAt),
        entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
      });
      game.lockRace(race.id, () => 0.5);
      database.prepare("UPDATE races SET status = 'betting_open' WHERE id = ?").run(race.id);
      return race.id;
    };
    const oldRaceId = createRace('旧レース', 100);
    const newRaceId = createRace('新レース', 1_000_000);

    expect(latestViewableRaceId(database, 99)).toBeUndefined();
    expect(latestViewableRaceId(database, 150)).toBe(oldRaceId);
    expect(latestViewableRaceId(database, 2_000_000)).toBe(newRaceId);

    database
      .prepare(
        `INSERT INTO discord_messages
         (id, purpose, race_id, channel_id, message_id, updated_at)
         VALUES ('message-row', 'race', ?, 'channel', 'message', 1)`,
      )
      .run(newRaceId);
    expect(listDiscordRaceMessages(database)).toEqual([
      { raceId: newRaceId, channelId: 'channel', messageId: 'message' },
    ]);
    expect(oldRaceId).not.toBe(newRaceId);
    database.close();
  });
});
