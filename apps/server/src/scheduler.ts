import {
  prepareRace,
  runClaimedJob,
  type JobHandlers,
  type PrivateObjectStore,
  type ScheduledJob,
} from '@jcb/application';
import type { Environment } from '@jcb/config';
import {
  SqliteAdminStore,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRaceLifecycleStore,
  SqliteRacePreparationRepository,
  type SqliteDatabase,
} from '@jcb/database';
import { timestamp, toJstDateKey, type Clock } from '@jcb/domain';
import type { Client } from 'discord.js';
import type { BackupProbe } from './backup-probe.js';
import { publishRaceMessage } from './discord-gateway.js';
import { publishRankingMessages } from './discord-ranking.js';
import { WorkerProbabilityGenerator } from './worker-probability-generator.js';

const POLL_INTERVAL_MILLISECONDS = 30_000;
const STALE_LOCK_MILLISECONDS = 5 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MILLISECONDS = 65 * 60 * 1_000;

export interface SchedulerDependencies {
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly timelineStore: PrivateObjectStore;
  readonly backupProbe?: BackupProbe;
  readonly discordClient?: Client;
}

export function startScheduler(dependencies: SchedulerDependencies): () => void {
  const workerId = `server:${process.pid.toString()}`;
  const jobStore = new SqliteJobStore(dependencies.database, cryptoJitter);
  const schedulerAdminStore = new SqliteAdminStore(dependencies.database, () =>
    dependencies.clock.now(),
  );
  jobStore.reclaimStale(dependencies.clock.now(), STALE_LOCK_MILLISECONDS);
  const handlers = createHandlers(dependencies, jobStore);
  let isPolling = false;

  const poll = async (): Promise<void> => {
    if (isPolling) return;
    isPolling = true;
    try {
      schedulerAdminStore.recordSystemSetting(
        'scheduler_heartbeat_at',
        new Date(dependencies.clock.now()).toISOString(),
      );
      for (let processed = 0; processed < 20; processed += 1) {
        const now = dependencies.clock.now();
        const job = jobStore.claimDue(now, workerId);
        if (job === undefined) break;
        const status = await runClaimedJob(
          jobStore,
          handlers,
          job,
          workerId,
          dependencies.clock.now(),
        );
        if (status === 'dead_letter') {
          const adminStore = new SqliteAdminStore(dependencies.database, () =>
            dependencies.clock.now(),
          );
          adminStore.recordAudit({
            action: 'job.dead_lettered',
            targetType: 'scheduled_job',
            targetId: job.id,
            reason: `${job.jobType} exhausted its retry policy.`,
          });
          await sendAdminNotice(
            dependencies,
            `🚨 ジョブがdead letterになりました: ${job.jobType} / ${job.id}`,
          );
        }
      }
    } finally {
      isPolling = false;
    }
  };
  void poll();
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MILLISECONDS);
  interval.unref();
  return () => clearInterval(interval);
}

function createHandlers(
  dependencies: SchedulerDependencies,
  jobStore: SqliteJobStore,
): JobHandlers {
  const resultMasterSecret = runtimeSecret(
    dependencies.environment.RESULT_MASTER_SECRET,
    dependencies.environment.NODE_ENV,
  );
  const timelineMasterSecret = runtimeSecret(
    dependencies.environment.TIMELINE_MASTER_SECRET,
    dependencies.environment.NODE_ENV,
  );
  const manifestPrivateKey = requireConfigured(
    dependencies.environment.MANIFEST_PRIVATE_KEY,
    'MANIFEST_PRIVATE_KEY',
    dependencies.environment.NODE_ENV,
  );
  const lifecycle = new SqliteRaceLifecycleStore(
    dependencies.database,
    () => dependencies.clock.now(),
    resultMasterSecret,
  );
  const gameStore = new SqliteGameStore(dependencies.database, () => dependencies.clock.now());
  const adminStore = new SqliteAdminStore(dependencies.database, () => dependencies.clock.now());

  const raceId = (job: ScheduledJob): string => {
    const value = job.payload.raceId;
    if (typeof value !== 'string') throw new Error('Job raceId is missing.');
    return value;
  };
  const publish = async (job: ScheduledJob): Promise<void> => {
    if (dependencies.discordClient === undefined) return;
    await publishRaceMessage({
      client: dependencies.discordClient,
      database: dependencies.database,
      environment: dependencies.environment,
      clock: dependencies.clock,
      raceId: raceId(job),
    });
  };

  return {
    async simulate_race(job) {
      const id = raceId(job);
      const seedPlan = gameStore.planSeedLiquidity(id);
      await sendAdminNotice(dependencies, `⏳ レースsimulation開始: ${id}`);
      let completion;
      try {
        completion = await prepareRace(id, {
          repository: new SqliteRacePreparationRepository(
            dependencies.database,
            () => dependencies.clock.now(),
            resultMasterSecret,
          ),
          timelineStore: dependencies.timelineStore,
          probabilityGenerator: new WorkerProbabilityGenerator(),
          timelineMasterSecret,
          resultMasterSecret,
          manifestPrivateKey,
          seedLiquidity: seedPlan.liquidity,
        });
      } catch (error) {
        await sendAdminNotice(
          dependencies,
          `🚨 レースsimulation失敗: ${id} / ${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}`,
        );
        throw error;
      }
      await sendAdminNotice(dependencies, `✅ レースsimulation完了・R2保存済み: ${id}`);
      const residentSetBytes = process.memoryUsage().rss;
      if (residentSetBytes >= 430 * 1_024 * 1_024) {
        await sendAdminNotice(
          dependencies,
          `⚠️ シミュレーション後RSSが警告水準です: ${String(Math.round(residentSetBytes / 1_024 / 1_024))} MiB`,
        );
      }
      const race = gameStore.getRace(id);
      const jobs = [
        {
          jobType: 'publish_race' as const,
          key: `publish:${id}:${String(race.version)}`,
          runAt: dependencies.clock.now(),
        },
        {
          jobType: 'grant_relief' as const,
          key: `relief:${race.raceDate}`,
          runAt: dependencies.clock.now(),
        },
        {
          jobType: 'open_viewer' as const,
          key: `open-viewer:${id}:${String(race.version)}`,
          runAt: race.viewerOpensAt,
        },
        {
          jobType: 'close_betting' as const,
          key: `close:${id}:${String(race.version)}`,
          runAt: race.bettingClosesAt,
        },
        {
          jobType: 'mark_running' as const,
          key: `running:${id}:${String(race.version)}`,
          runAt: race.scheduledAt,
        },
        {
          jobType: 'mark_finished' as const,
          key: `finished:${id}:${String(race.version)}`,
          runAt: timestamp(race.scheduledAt + completion.official.timelineDurationMs),
        },
        {
          jobType: 'settle_race' as const,
          key: `settle:${id}:${String(race.version)}`,
          runAt: timestamp(race.scheduledAt + completion.official.timelineDurationMs + 3_000),
        },
      ];
      for (const scheduled of jobs) {
        jobStore.enqueue({
          jobType: scheduled.jobType,
          deduplicationKey: scheduled.key,
          payload: { raceId: id },
          runAt: scheduled.runAt,
        });
      }
    },
    publish_race: publish,
    refresh_race_message: publish,
    open_viewer: publish,
    async close_betting(job) {
      const id = raceId(job);
      lifecycle.closeBetting(id, dependencies.clock.now());
      lifecycle.markReady(id);
      await publish(job);
    },
    async mark_running(job) {
      lifecycle.markRunning(raceId(job), dependencies.clock.now());
      await publish(job);
    },
    async mark_finished(job) {
      lifecycle.markFinished(raceId(job), dependencies.clock.now());
    },
    async settle_race(job) {
      lifecycle.settleRace(raceId(job), dependencies.clock.now());
      await publish(job);
      await sendAdminNotice(dependencies, `✅ レース精算完了: ${raceId(job)}`);
      jobStore.enqueue({
        jobType: 'refresh_rankings',
        deduplicationKey: `rankings:${raceId(job)}:${String(dependencies.clock.now())}`,
        payload: { raceId: raceId(job) },
        runAt: dependencies.clock.now(),
      });
    },
    async grant_relief(job) {
      const date =
        typeof job.payload.jstDate === 'string'
          ? job.payload.jstDate
          : toJstDateKey(dependencies.clock.now());
      gameStore.grantDailyRelief(date);
    },
    async economic_integrity_check() {
      gameStore.ledgerStore().assertProjectionIntegrity();
      const health = adminStore.health();
      if (BigInt(health.centralBankBalance) < 2_000_000n) {
        adminStore.recordAudit({
          action: 'economy.central_bank_low',
          targetType: 'account',
          targetId: 'central-bank',
          reason: 'Central bank balance is below 2,000,000 R.',
          after: { balance: health.centralBankBalance },
        });
        await sendAdminNotice(
          dependencies,
          `⚠️ 中央銀行残高が警告水準です: ${BigInt(health.centralBankBalance).toLocaleString('ja-JP')} R`,
        );
      }
    },
    async warn_missing_race() {
      const date = toJstDateKey(dependencies.clock.now());
      const hasRace = gameStore.listRaces().some((race) => race.raceDate === date);
      if (!hasRace) {
        adminStore.recordAudit({
          action: 'race.missing_warning',
          targetType: 'race_date',
          targetId: date,
          reason: 'No race existed at the configured warning time.',
        });
        await sendAdminNotice(dependencies, `⚠️ ${date} のレースがまだ作成されていません。`);
      }
    },
    async refresh_rankings() {
      if (
        dependencies.discordClient === undefined ||
        dependencies.environment.DISCORD_RANKING_CHANNEL_ID === undefined
      ) {
        return;
      }
      await publishRankingMessages({
        client: dependencies.discordClient,
        database: dependencies.database,
        clock: dependencies.clock,
        channelId: dependencies.environment.DISCORD_RANKING_CHANNEL_ID,
      });
    },
    async backup_check() {
      const checkedAt = dependencies.clock.now();
      const nextCheck = timestamp(
        (Math.floor(checkedAt / (60 * 60 * 1_000)) + 1) * 60 * 60 * 1_000,
      );
      jobStore.enqueue({
        jobType: 'backup_check',
        deduplicationKey: `backup-check:${String(nextCheck)}`,
        payload: {},
        runAt: nextCheck,
      });
      try {
        if (dependencies.backupProbe === undefined) {
          if (dependencies.environment.NODE_ENV === 'production') {
            throw new Error('Production backup probe is not configured.');
          }
          return;
        }
        await verifyBackupProbe(dependencies.backupProbe, checkedAt, (key, value) =>
          adminStore.recordSystemSetting(key, value),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown backup probe error.';
        adminStore.recordAudit({
          action: 'backup.check_failed',
          targetType: 'backup',
          targetId: 'litestream-r2',
          reason,
        });
        await sendAdminNotice(dependencies, `🚨 バックアップ監視に失敗しました: ${reason}`);
        throw error;
      }
    },
  };
}

export async function verifyBackupProbe(
  probe: BackupProbe,
  checkedAt: number,
  recordSetting: (key: string, value: string) => void,
): Promise<void> {
  const latest = await probe.latestBackupAt();
  recordSetting('last_r2_access_at', new Date(checkedAt).toISOString());
  if (latest === undefined || checkedAt - latest > BACKUP_MAXIMUM_AGE_MILLISECONDS) {
    throw new Error('No R2 backup object was updated within 65 minutes.');
  }
  recordSetting('last_backup_success_at', new Date(latest).toISOString());
}

async function sendAdminNotice(
  dependencies: SchedulerDependencies,
  content: string,
): Promise<void> {
  if (
    dependencies.discordClient === undefined ||
    dependencies.environment.DISCORD_ADMIN_CHANNEL_ID === undefined
  ) {
    return;
  }
  const channel = await dependencies.discordClient.channels.fetch(
    dependencies.environment.DISCORD_ADMIN_CHANNEL_ID,
  );
  if (channel !== null && channel.isSendable()) await channel.send({ content });
}

function runtimeSecret(value: string | undefined, nodeEnvironment: string): string {
  if (value !== undefined) return value;
  if (nodeEnvironment === 'production')
    throw new Error('Required cryptographic secret is missing.');
  return Buffer.alloc(32, 7).toString('base64');
}

function requireConfigured(
  value: string | undefined,
  key: string,
  nodeEnvironment: string,
): string {
  if (value !== undefined) return value;
  if (nodeEnvironment === 'production') throw new Error(`${key} is missing.`);
  throw new Error(`${key} is required to simulate a race in development.`);
}

function cryptoJitter(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0]! / 4_294_967_296;
}
