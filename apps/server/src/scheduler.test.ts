import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRace, type PrivateObjectStore, type ProbabilityGenerator } from '@jcb/application';
import { parseEnvironment } from '@jcb/config';
import { timestamp } from '@jcb/domain';
import { generateProbabilities } from '@jcb/odds';
import {
  applyMigrations,
  openDatabase,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRacePreparationRepository,
  type HorseWrite,
} from '@jcb/database';
import { startScheduler, verifyBackupProbe } from './scheduler.js';

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const migrationsDirectory = join(repositoryRoot, 'packages', 'database', 'migrations');

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

describe('backup health probe', () => {
  it('records successful R2 access before reporting a missing first backup', async () => {
    const recorded: Array<readonly [string, string]> = [];
    await expect(
      verifyBackupProbe(
        { latestBackupAt: async () => undefined },
        1_800_000_000_000,
        (key, value) => recorded.push([key, value]),
      ),
    ).rejects.toThrow(/65 minutes/);
    expect(recorded).toEqual([['last_r2_access_at', new Date(1_800_000_000_000).toISOString()]]);
  });

  it('records both R2 access and a fresh backup', async () => {
    const checkedAt = 1_800_000_000_000;
    const latest = checkedAt - 60 * 60 * 1_000;
    const recorded: Array<readonly [string, string]> = [];
    await verifyBackupProbe({ latestBackupAt: async () => latest }, checkedAt, (key, value) =>
      recorded.push([key, value]),
    );
    expect(recorded).toEqual([
      ['last_r2_access_at', new Date(checkedAt).toISOString()],
      ['last_backup_success_at', new Date(latest).toISOString()],
    ]);
  });
});

describe('race scheduler recovery', () => {
  it('rebuilds follow-up jobs when a prepared simulation job is reclaimed after restart', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    try {
      const gameStore = new SqliteGameStore(database, () => now);
      gameStore.initializeEconomy([]);
      const horses = Array.from({ length: 8 }, (_, index) =>
        gameStore.createHorse({
          ...horseBase,
          name: `再起動試験馬${index + 1}`,
          speed: 48 + index,
        }),
      );
      const raceDraft = gameStore.createRaceDraft({
        raceDate: '2026-08-12',
        name: '再起動回復試験',
        distanceM: 1200,
        surface: 'turf',
        scheduledAt: timestamp(now + 100_000),
        bettingOpensAt: timestamp(now + 10_000),
        bettingClosesAt: timestamp(now + 90_000),
        viewerOpensAt: timestamp(now + 80_000),
        entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
      });
      const race = gameStore.lockRace(raceDraft.id, () => 0.5);

      const resultMasterSecret = randomBytes(32).toString('base64');
      const timelineMasterSecret = randomBytes(32).toString('base64');
      const { privateKey } = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const timelineStore: PrivateObjectStore = {
        async put() {
          return;
        },
        async get() {
          return undefined;
        },
        async delete() {
          return;
        },
        async list() {
          return [];
        },
      };
      const probabilityGenerator: ProbabilityGenerator = {
        async generate(input, seed) {
          return generateProbabilities(input, seed, 120);
        },
      };
      await prepareRace(race.id, {
        repository: new SqliteRacePreparationRepository(database, () => now, resultMasterSecret),
        probabilityGenerator,
        timelineMasterSecret,
        resultMasterSecret,
        manifestPrivateKey: privateKey,
      });

      const staleAt = timestamp(now - 6 * 60 * 1_000);
      const jobsBeforeRestart = new SqliteJobStore(
        database,
        () => 0.5,
        () => staleAt,
      );
      const simulationJob = jobsBeforeRestart.enqueue({
        jobType: 'simulate_race',
        deduplicationKey: `simulate:${race.id}:${String(race.version)}:recovery`,
        payload: { raceId: race.id },
        runAt: staleAt,
      });
      expect(jobsBeforeRestart.claimDue(staleAt, 'old-worker')?.id).toBe(simulationJob.id);

      const publishKey = `publish:${race.id}:${String(race.version)}`;
      const originalPublishAt = timestamp(now - 60_000);
      jobsBeforeRestart.enqueue({
        jobType: 'publish_race',
        deduplicationKey: publishKey,
        payload: { raceId: race.id },
        runAt: originalPublishAt,
      });

      const errors: unknown[] = [];
      const stopScheduler = startScheduler({
        database,
        environment: parseEnvironment({
          NODE_ENV: 'test',
          RESULT_MASTER_SECRET: resultMasterSecret,
          TIMELINE_MASTER_SECRET: timelineMasterSecret,
          MANIFEST_PRIVATE_KEY: privateKey,
        }),
        clock: { now: () => timestamp(now) },
        timelineStore,
        onError: (error) => errors.push(error),
      });
      try {
        await waitFor(() => {
          const row = database
            .prepare('SELECT status FROM scheduled_jobs WHERE id = ?')
            .get(simulationJob.id) as { status: string } | undefined;
          return row?.status === 'completed';
        });

        const followUpKeys = [
          publishKey,
          `relief:${race.raceDate}`,
          `open-viewer:${race.id}:${String(race.version)}`,
          `close:${race.id}:${String(race.version)}`,
          `running:${race.id}:${String(race.version)}`,
          `finished:${race.id}:${String(race.version)}`,
          `settle:${race.id}:${String(race.version)}`,
        ];
        const recovered = followUpKeys.map((key) => jobsBeforeRestart.getByDeduplicationKey(key));
        expect(recovered.every((job) => job !== undefined)).toBe(true);
        expect(jobsBeforeRestart.getByDeduplicationKey(publishKey)?.runAt).toBe(originalPublishAt);
        expect(gameStore.getRace(race.id).status).toBe('betting_open');
        expect(errors).toEqual([]);
      } finally {
        await stopScheduler();
      }
    } finally {
      database.close();
    }
  });
});

async function waitFor(condition: () => boolean, timeoutMilliseconds = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for scheduler recovery.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
