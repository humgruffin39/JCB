import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRace, type PrivateObjectStore, type ProbabilityGenerator } from '@jcb/application';
import { timestamp } from '@jcb/domain';
import { generateProbabilities } from '@jcb/odds';
import { openDatabase } from './connection.js';
import { SqliteGameStore, type HorseWrite } from './game-store.js';
import { applyMigrations } from './migrations.js';
import { SqliteRacePreparationRepository } from './race-preparation-repository.js';

class TestObjectStore implements PrivateObjectStore {
  public readonly objects = new Map<string, Uint8Array>();

  public async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }
}

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

describe('race preparation workflow', () => {
  it('regenerates seeds after a failed preparation when the master secret changes', () => {
    const now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const gameStore = new SqliteGameStore(database, () => now);
    gameStore.initializeEconomy([]);
    const horses = Array.from({ length: 8 }, (_, index) =>
      gameStore.createHorse({
        ...horseBase,
        name: `鍵更新馬${index + 1}`,
        speed: 48 + index,
      }),
    );
    const race = gameStore.createRaceDraft({
      raceDate: '2026-08-06',
      name: '鍵更新試験',
      distanceM: 2000,
      surface: 'turf',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(10_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    gameStore.lockRace(race.id, () => 0.5);
    const original = new SqliteRacePreparationRepository(
      database,
      () => now,
      randomBytes(32).toString('base64'),
    );
    original.begin(race.id);
    original.fail(race.id, 'TEST_FAILURE', 'test failure');

    const replacement = new SqliteRacePreparationRepository(
      database,
      () => now,
      randomBytes(32).toString('base64'),
    );
    const retried = replacement.begin(race.id);

    expect(retried.officialSeed).toBeTruthy();
    expect(retried.oddsSeed).toBeTruthy();
    expect(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM race_simulations
             WHERE race_id = ? AND status = 'running'`,
          )
          .get(race.id) as { count: bigint }
      ).count,
    ).toBe(2n);
    database.close();
  });

  it('generates encrypted official output and independent odds before opening betting', async () => {
    const now = 1_000;
    const database = openDatabase(':memory:');
    applyMigrations(
      database,
      join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations'),
      now,
    );
    const gameStore = new SqliteGameStore(database, () => now);
    gameStore.initializeEconomy([]);
    const horses = Array.from({ length: 8 }, (_, index) =>
      gameStore.createHorse({
        ...horseBase,
        name: `準備馬${index + 1}`,
        speed: 48 + index,
      }),
    );
    const race = gameStore.createRaceDraft({
      raceDate: '2026-08-05',
      name: '準備試験',
      distanceM: 1200,
      surface: 'dirt',
      scheduledAt: timestamp(100_000),
      bettingOpensAt: timestamp(10_000),
      bettingClosesAt: timestamp(90_000),
      viewerOpensAt: timestamp(80_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    gameStore.lockRace(race.id, () => 0.5);
    const resultMasterSecret = randomBytes(32).toString('base64');
    const timelineMasterSecret = randomBytes(32).toString('base64');
    const { privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const timelineStore = new TestObjectStore();
    const probabilityGenerator: ProbabilityGenerator = {
      async generate(input, seed) {
        return generateProbabilities(input, seed, 150);
      },
    };
    const completion = await prepareRace(race.id, {
      repository: new SqliteRacePreparationRepository(database, () => now, resultMasterSecret),
      timelineStore,
      probabilityGenerator,
      timelineMasterSecret,
      resultMasterSecret,
      manifestPrivateKey: privateKey,
    });
    expect(gameStore.getRace(race.id).status).toBe('betting_open');
    expect(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM odds_probabilities WHERE race_id = ?')
          .get(race.id) as { count: bigint }
      ).count,
    ).toBe(344n);
    expect(timelineStore.objects.has(completion.timelineObjectKey)).toBe(true);
    expect(timelineStore.objects.has(`race-manifests/${race.id}.json`)).toBe(true);
    expect(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM race_entries WHERE race_id = ? AND finish_position IS NOT NULL',
          )
          .get(race.id) as { count: bigint }
      ).count,
    ).toBe(0n);
    const simulation = database
      .prepare(
        `SELECT seed_ciphertext AS seedCiphertext, encrypted_result_blob AS encryptedResult
         FROM race_simulations WHERE race_id = ? AND kind = 'official'`,
      )
      .get(race.id) as { seedCiphertext: string; encryptedResult: string };
    expect(simulation.seedCiphertext).not.toContain('finishOrder');
    expect(simulation.encryptedResult).not.toContain('finishOrder');
    database.close();
  });
});
