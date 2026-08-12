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
  SqliteObjectPublicationStore,
  SqliteRacePreparationRepository,
  type HorseWrite,
} from '@jcb/database';
import {
  cleanupOrphanedTimelineObjects,
  repairMissingPublishedObjects,
  startScheduler,
  verifyBackupProbe,
} from './scheduler.js';

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

describe('timeline object cleanup', () => {
  it('preserves active publications and removes old cancelled or unreferenced objects', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue('timelines/active.bin', new Uint8Array([1]), { raceId: 'active' }, now);
    publications.enqueue(
      'timelines/cancelled.bin',
      new Uint8Array([2]),
      { raceId: 'cancelled' },
      now,
    );
    publications.cancelForRace('cancelled', now);
    const deleted: string[] = [];
    const objectStore: PrivateObjectStore = {
      async put() {
        return;
      },
      async get() {
        return undefined;
      },
      async delete(key) {
        deleted.push(key);
      },
      async list() {
        return [
          { key: 'timelines/active.bin', lastModifiedAt: now - 10_000 },
          { key: 'timelines/cancelled.bin', lastModifiedAt: now - 10_000 },
          { key: 'timelines/orphan.bin', lastModifiedAt: now - 10_000 },
        ];
      },
    };

    await expect(cleanupOrphanedTimelineObjects(database, objectStore, now, 0)).resolves.toBe(2);
    expect(deleted.sort()).toEqual(['timelines/cancelled.bin', 'timelines/orphan.bin']);
    database.close();
  });
});

describe('published object repair', () => {
  it('requeues missing current-race objects from the durable outbox', async () => {
    const now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    applyMigrations(database, migrationsDirectory, now);
    const timelineKey = 'timelines/race-1/verified.bin';
    const manifestKey = 'race-manifests/race-1.json';
    const timelineBody = new Uint8Array([1, 2, 3]);
    const manifestBody = new Uint8Array([4, 5, 6]);
    database
      .prepare(
        `INSERT INTO races
         (id, race_date, name, kind, status, version, distance_m, going,
          scheduled_at, betting_opens_at, betting_closes_at, viewer_opens_at,
          created_at, updated_at)
         VALUES ('race-1', '2026-08-12', '復旧確認', 'regular', 'settled', 1, 1200, 'firm',
                 100000, 80000, 90000, 70000, 1000, 1000)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO race_simulations
         (id, race_id, race_version, kind, status, seed_ciphertext, prng_version,
          simulation_version, input_hash, timeline_object_key, timeline_sha256,
          started_at, completed_at)
         VALUES ('simulation-1', 'race-1', 1, 'official', 'completed', '{}', 'prng-v1',
                 'simulation-v1', 'input-hash', ?, ?, 1000, 1000)`,
      )
      .run(timelineKey, 'timeline-hash');
    const publications = new SqliteObjectPublicationStore(database);
    publications.enqueue(timelineKey, timelineBody, { raceId: 'race-1' }, now);
    publications.enqueue(manifestKey, manifestBody, { raceId: 'race-1' }, now + 1);
    const timelinePublication = publications.claimDue(now + 1, 'publisher');
    expect(timelinePublication?.key).toBe(timelineKey);
    publications.complete(timelinePublication!.id, 'publisher', now + 1);
    const manifestPublication = publications.claimDue(now + 1, 'publisher');
    expect(manifestPublication?.key).toBe(manifestKey);
    publications.complete(manifestPublication!.id, 'publisher', now + 1);
    const objectStore: PrivateObjectStore = {
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

    await expect(repairMissingPublishedObjects(database, objectStore, now + 1)).resolves.toEqual({
      requeued: [timelineKey, manifestKey],
      unrecoverable: [],
    });
    const repairedKeys = [
      publications.claimDue(now + 1, 'repair-worker')?.key,
      publications.claimDue(now + 1, 'repair-worker')?.key,
    ].sort();
    expect(repairedKeys).toEqual([manifestKey, timelineKey].sort());
    database.close();
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
