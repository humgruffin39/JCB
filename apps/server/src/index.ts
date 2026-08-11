import { DEFAULT_GAME_SETTINGS, gameSettingsSchema, parseEnvironment } from '@jcb/config';
import { applyMigrations, openDatabase, SqliteGameStore, SqliteJobStore } from '@jcb/database';
import { jstDateTimeToTimestamp, timestamp, toJstDateKey, type Timestamp } from '@jcb/domain';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-app.js';
import { R2BackupProbe } from './backup-probe.js';
import { createDiscordClient, wireDiscordGateway } from './discord-gateway.js';
import { DiscordClientGuildMembership } from './guild-membership.js';
import { FilePrivateObjectStore, R2PrivateObjectStore } from './object-store.js';
import { startScheduler } from './scheduler.js';
import { SystemClock } from './system-clock.js';

const environment = parseEnvironment(process.env);
const clock = new SystemClock();
const database = openDatabase(environment.DATABASE_PATH);
const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
applyMigrations(database, join(repositoryRoot, 'packages', 'database', 'migrations'), clock.now());
const initialAdmins = environment.INITIAL_ADMIN_DISCORD_IDS.split(',')
  .map((id) => id.trim())
  .filter(Boolean);
new SqliteGameStore(database, () => clock.now()).initializeEconomy(initialAdmins);

const discordClient =
  environment.DISCORD_BOT_TOKEN === undefined || environment.DISCORD_GUILD_ID === undefined
    ? undefined
    : createDiscordClient();
if (discordClient !== undefined) {
  wireDiscordGateway({ client: discordClient, database, environment, clock });
  await discordClient.login(environment.DISCORD_BOT_TOKEN);
}
if (
  environment.NODE_ENV === 'production' &&
  (discordClient === undefined || environment.DISCORD_GUILD_ID === undefined)
) {
  throw new Error('Discord configuration is required in production.');
}
const membership =
  discordClient !== undefined && environment.DISCORD_GUILD_ID !== undefined
    ? new DiscordClientGuildMembership(discordClient, environment.DISCORD_GUILD_ID)
    : {
        async isCurrentMember() {
          return environment.NODE_ENV !== 'production';
        },
      };

const timelineStore =
  environment.NODE_ENV === 'production'
    ? new R2PrivateObjectStore(
        requireEnvironment(environment.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID'),
        requireEnvironment(environment.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
        requireEnvironment(environment.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
        requireEnvironment(environment.R2_TIMELINE_BUCKET, 'R2_TIMELINE_BUCKET'),
      )
    : new FilePrivateObjectStore(join(repositoryRoot, '.private-objects'));
const backupProbe =
  environment.NODE_ENV === 'production'
    ? new R2BackupProbe(
        requireEnvironment(environment.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID'),
        requireEnvironment(environment.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
        requireEnvironment(environment.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
        requireEnvironment(environment.R2_BACKUP_BUCKET, 'R2_BACKUP_BUCKET'),
      )
    : undefined;

const app = await buildServer({
  database,
  environment,
  clock,
  membership,
  timelineStore,
  discordStatus: () => discordClient?.isReady() ?? false,
  ...(discordClient === undefined || environment.DISCORD_ADMIN_CHANNEL_ID === undefined
    ? {}
    : {
        adminNotifier: async (message: string) => {
          const channel = await discordClient.channels.fetch(environment.DISCORD_ADMIN_CHANNEL_ID!);
          if (channel !== null && channel.isSendable()) {
            await channel.send({ content: message });
          }
        },
      }),
});
await app.listen({ host: environment.HOST, port: environment.PORT });

scheduleSystemJobs(database, clock.now());
const canRunRaceScheduler =
  environment.MANIFEST_PRIVATE_KEY !== undefined &&
  environment.RESULT_MASTER_SECRET !== undefined &&
  environment.TIMELINE_MASTER_SECRET !== undefined;
const stopScheduler = canRunRaceScheduler
  ? startScheduler({
      database,
      environment,
      clock,
      timelineStore,
      onError: (error) => app.log.error({ err: error }, 'scheduler poll failed'),
      ...(backupProbe === undefined ? {} : { backupProbe }),
      ...(discordClient === undefined ? {} : { discordClient }),
    })
  : noOperation;
if (!canRunRaceScheduler) {
  app.log.warn('Race scheduler is disabled until cryptographic secrets are configured.');
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  stopScheduler();
  await app.close();
  if (discordClient !== undefined) await discordClient.destroy();
  database.close();
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function noOperation(): void {
  return;
}

function scheduleSystemJobs(sqlite: ReturnType<typeof openDatabase>, now: Timestamp): void {
  const jobs = new SqliteJobStore(
    sqlite,
    () => 0.5,
    () => now,
  );
  const storedSettings = sqlite
    .prepare("SELECT value_json AS valueJson FROM app_settings WHERE key = 'game_settings'")
    .get() as { valueJson: string } | undefined;
  const parsedSettings = gameSettingsSchema.safeParse(
    storedSettings === undefined ? DEFAULT_GAME_SETTINGS : JSON.parse(storedSettings.valueJson),
  );
  const settings = parsedSettings.success ? parsedSettings.data : DEFAULT_GAME_SETTINGS;
  for (const offset of [0, 1]) {
    const date = addJstDays(toJstDateKey(now), offset);
    const definitions = [
      {
        jobType: 'economic_integrity_check' as const,
        time: '16:30:00',
        key: `economy-integrity:${date}`,
      },
      {
        jobType: 'warn_missing_race' as const,
        time: settings.missingRaceWarningTime,
        key: `warn-missing-race:${date}`,
      },
      {
        jobType: 'refresh_rankings' as const,
        time: '00:00:00',
        key: `rankings-daily:${date}`,
      },
    ];
    for (const definition of definitions) {
      const scheduled = jstDateTimeToTimestamp(date, definition.time);
      jobs.enqueue({
        jobType: definition.jobType,
        deduplicationKey: definition.key,
        payload: { jstDate: date },
        runAt: scheduled < now ? now : scheduled,
      });
    }
  }
  jobs.enqueue({
    jobType: 'backup_check',
    deduplicationKey: `backup-check:${String(now)}`,
    payload: {},
    runAt: now,
  });
}

function addJstDays(date: string, days: number): string {
  const epoch = Date.parse(`${date}T00:00:00+09:00`) + days * 24 * 60 * 60 * 1000;
  return toJstDateKey(timestamp(epoch));
}

function requireEnvironment(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}
