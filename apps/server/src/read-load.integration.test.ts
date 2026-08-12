import { parseEnvironment } from '@jcb/config';
import {
  applyMigrations,
  openDatabase,
  SqliteAuthStore,
  SqliteGameStore,
  type HorseWrite,
} from '@jcb/database';
import { timestamp } from '@jcb/domain';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-app.js';
import { SystemClock } from './system-clock.js';

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const migrationsDirectory = join(repositoryRoot, 'packages', 'database', 'migrations');

describe('read-only race load', () => {
  it('serves 50 concurrent race reads through the real server and SQLite store', async () => {
    const now = Date.now();
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy([]);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        ...horseBase,
        name: `負荷試験馬${String(index + 1)}`,
        speed: 48 + index,
      }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-12',
      name: '実サーバー負荷試験',
      distanceM: 1_600,
      surface: 'turf',
      scheduledAt: timestamp(now + 60 * 60 * 1_000),
      bettingOpensAt: timestamp(now),
      bettingClosesAt: timestamp(now + 30 * 60 * 1_000),
      viewerOpensAt: timestamp(now + 30 * 60 * 1_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);

    const app = await buildServer({
      database,
      environment: parseEnvironment({ NODE_ENV: 'test' }),
      clock: new SystemClock(),
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
    });
    try {
      const session = new SqliteAuthStore(database, () => now).createOAuthSession('load-test');
      const started = performance.now();
      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          app.inject({
            method: 'GET',
            url: `/api/v1/races/${encodeURIComponent(race.id)}`,
            headers: { cookie: `jcb_session=${session.sessionToken}` },
          }),
        ),
      );
      const elapsed = performance.now() - started;
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await app.close();
      database.close();
    }
  });
});

const horseBase: Omit<HorseWrite, 'name' | 'speed'> = {
  status: 'active',
  runningStyle: 'front_runner',
  start: 50,
  acceleration: 50,
  stamina: 50,
  lateKick: 50,
  conditionStability: 50,
  distancePreference: 0,
  surfacePreference: 0,
};
