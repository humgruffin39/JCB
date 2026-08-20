import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRace, type PrivateObjectStore, type ProbabilityGenerator } from '@jcb/application';
import { parseEnvironment } from '@jcb/config';
import {
  applyMigrations,
  openDatabase,
  SqliteAuthStore,
  SqliteGameStore,
  SqliteRacePreparationRepository,
} from '@jcb/database';
import { timestamp } from '@jcb/domain';
import { generateProbabilities } from '@jcb/odds';
import { buildServer } from './build-app.js';

class TestObjectStore implements PrivateObjectStore {
  public readonly objects = new Map<string, Uint8Array>();

  public async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async list(prefix: string) {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, lastModifiedAt: undefined }));
  }
}

describe('admin rehearsal scheduling', () => {
  it('publishes the viewer immediately and schedules the lifecycle one minute later', async () => {
    let now = 1_800_000_000_000;
    const database = openDatabase(':memory:');
    const migrationsDirectory = join(
      dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
      'packages',
      'database',
      'migrations',
    );
    applyMigrations(database, migrationsDirectory, now);
    const game = new SqliteGameStore(database, () => now);
    game.initializeEconomy(['123456']);
    game.registerUser('123456', '管理者', true);
    const horses = Array.from({ length: 8 }, (_, index) =>
      game.createHorse({
        name: `進行試験馬${index + 1}`,
        status: 'active',
        runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
        speed: 50,
        start: 50,
        acceleration: 50,
        stamina: 50,
        lateKick: 50,
        conditionStability: 50,
        distancePreference: 0,
        surfacePreference: 0,
      }),
    );
    const race = game.createRaceDraft({
      raceDate: '2026-08-14',
      name: '進行試験',
      distanceM: 1_200,
      surface: 'turf',
      scheduledAt: timestamp(now + 600_000),
      bettingOpensAt: timestamp(now - 120_000),
      bettingClosesAt: timestamp(now + 300_000),
      viewerOpensAt: timestamp(now + 240_000),
      entries: horses.map((horse, index) => ({ horseId: horse.id, horseNumber: index + 1 })),
    });
    game.lockRace(race.id, () => 0.5);

    const resultMasterSecret = randomBytes(32).toString('base64');
    const timelineMasterSecret = randomBytes(32).toString('base64');
    const edgeKeys = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const manifestKeys = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const preparation = await prepareRace(race.id, {
      repository: new SqliteRacePreparationRepository(database, () => now, resultMasterSecret),
      probabilityGenerator: {
        async generate(input, seed) {
          return generateProbabilities(input, seed, 150);
        },
      } satisfies ProbabilityGenerator,
      timelineMasterSecret,
      resultMasterSecret,
      manifestPrivateKey: manifestKeys.privateKey,
    });
    const objectStore = new TestObjectStore();
    await objectStore.put(
      `race-manifests/${race.id}.json`,
      Buffer.from(JSON.stringify(preparation.signedManifest), 'utf8'),
    );
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      INITIAL_ADMIN_DISCORD_IDS: '123456',
      SESSION_SECRET: randomBytes(32).toString('base64'),
      RESULT_MASTER_SECRET: resultMasterSecret,
      TIMELINE_MASTER_SECRET: timelineMasterSecret,
      DISCORD_GUILD_ID: '123456789',
      EDGE_TOKEN_PRIVATE_KEY: edgeKeys.privateKey,
      EDGE_TOKEN_PUBLIC_KEY: edgeKeys.publicKey,
      MANIFEST_PRIVATE_KEY: manifestKeys.privateKey,
      MANIFEST_PUBLIC_KEY: manifestKeys.publicKey,
    });
    const app = await buildServer({
      database,
      environment,
      clock: { now: () => timestamp(now) },
      membership: {
        async isCurrentMember() {
          return true;
        },
      },
      timelineStore: objectStore,
    });
    const session = new SqliteAuthStore(database, () => now).createOAuthSession('123456');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/races/${race.id}/rehearse-now`,
      headers: {
        cookie: `jcb_session=${session.sessionToken}`,
        'x-csrf-token': session.csrfToken,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      result: {
        scheduled: true,
        viewerOpensAt: now,
        scheduledAt: now + 60_000,
      },
    });
    expect(game.getRace(race.id).status).toBe('ready');
    expect(game.getRace(race.id).scheduledAt).toBe(now + 60_000);
    expect(
      JSON.parse(
        Buffer.from(objectStore.objects.get(`race-manifests/${race.id}.json`) ?? []).toString(
          'utf8',
        ),
      ),
    ).toMatchObject({
      manifest: { scheduledStart: now + 60_000, viewerOpensAt: now },
    });
    expect(
      database
        .prepare(
          `SELECT status, run_at AS runAt FROM scheduled_jobs
           WHERE job_type = 'mark_running' AND json_extract(payload_json, '$.raceId') = ?`,
        )
        .get(race.id),
    ).toMatchObject({ status: 'pending', runAt: BigInt(now + 60_000) });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM scheduled_jobs
           WHERE job_type = 'notify_race_start' AND json_extract(payload_json, '$.raceId') = ?`,
        )
        .get(race.id),
    ).toEqual({ count: 0n });
    const pendingManifest = database
      .prepare(
        `SELECT body FROM object_publications
         WHERE object_key = ?`,
      )
      .get(`race-manifests/${race.id}.json`) as { body: Uint8Array };
    expect(JSON.parse(Buffer.from(pendingManifest.body).toString('utf8'))).toMatchObject({
      manifest: { scheduledStart: now + 60_000, viewerOpensAt: now },
    });

    now += 60_000;
    await app.close();
    database.close();
  });
});
