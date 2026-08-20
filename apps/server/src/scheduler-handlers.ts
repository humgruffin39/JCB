import { prepareRace, type JobHandlers, type ScheduledJob } from '@jcb/application';
import {
  SqliteAdminStore,
  SqliteDiscordMessageStore,
  SqliteGameStore,
  SqliteRaceLifecycleStore,
  SqliteRacePreparationRepository,
  type SqliteJobStore,
} from '@jcb/database';
import {
  formatDateKeyForDisplay,
  jstDateTimeToTimestamp,
  timestamp,
  toJstDateKey,
} from '@jcb/domain';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publishRaceMessage } from './discord-gateway.js';
import { assignRacingRole } from './discord-racing-role.js';
import { deleteRaceStartReminder, sendRaceStartReminder } from './discord-race-reminder.js';
import { publishRankingMessages } from './discord-ranking.js';
import { verifyBackupProbe } from './scheduler-backup.js';
import { enqueueRaceFollowUpJobs, loadPreparedRaceTiming } from './scheduler-race-jobs.js';
import {
  nextMonthKey,
  requireConfigured,
  runtimeSecrets,
  sendAdminNotice,
} from './scheduler-support.js';
import type { SchedulerDependencies } from './scheduler-types.js';
import { WorkerProbabilityGenerator } from './worker-probability-generator.js';

const execFileAsync = promisify(execFile);

export function createHandlers(
  dependencies: SchedulerDependencies,
  jobStore: SqliteJobStore,
): JobHandlers {
  const resultMasterSecrets = runtimeSecrets(
    dependencies.environment.RESULT_MASTER_SECRET,
    dependencies.environment.RESULT_MASTER_SECRET_PREVIOUS,
    dependencies.environment.NODE_ENV,
  );
  const timelineMasterSecrets = runtimeSecrets(
    dependencies.environment.TIMELINE_MASTER_SECRET,
    dependencies.environment.TIMELINE_MASTER_SECRET_PREVIOUS,
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
    resultMasterSecrets,
  );
  const gameStore = new SqliteGameStore(dependencies.database, () => dependencies.clock.now());
  const adminStore = new SqliteAdminStore(dependencies.database, () => dependencies.clock.now());

  const raceId = (job: ScheduledJob): string => {
    const value = job.payload.raceId;
    if (typeof value !== 'string') throw new Error('Job raceId is missing.');
    return value;
  };
  const raceVersion = (job: ScheduledJob): number | undefined => {
    const payloadVersion = job.payload.raceVersion;
    if (
      typeof payloadVersion === 'number' &&
      Number.isSafeInteger(payloadVersion) &&
      payloadVersion > 0
    ) {
      return payloadVersion;
    }
    const keyVersion =
      /^(?:simulate|publish|refresh-race|notify-race-start|open-viewer|close|running|finished|settle):[^:]+:(\d+)(?::|$)/.exec(
        job.deduplicationKey,
      )?.[1];
    if (keyVersion === undefined) return undefined;
    const parsed = Number(keyVersion);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const cancellationRaceVersion = (job: ScheduledJob): number | undefined => {
    const payloadVersion = job.payload.raceVersion;
    if (
      typeof payloadVersion === 'number' &&
      Number.isSafeInteger(payloadVersion) &&
      payloadVersion >= 0
    ) {
      return payloadVersion;
    }
    const keyVersion = /^refresh-race:[^:]+:(\d+)(?::|$)/.exec(job.deduplicationKey)?.[1];
    if (keyVersion === undefined) return undefined;
    const parsed = Number(keyVersion);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const isCurrentRaceJob = (job: ScheduledJob): boolean => {
    const expectedVersion = raceVersion(job);
    if (expectedVersion === undefined) return true;
    const race = gameStore.getRace(raceId(job));
    return race.version === expectedVersion && race.status !== 'cancelled';
  };
  const publish = async (
    job: ScheduledJob,
    options: { readonly disablePreviousViewers?: boolean } = {},
  ): Promise<void> => {
    if (!isCurrentRaceJob(job)) return;
    if (dependencies.discordClient === undefined) return;
    await publishRaceMessage({
      client: dependencies.discordClient,
      database: dependencies.database,
      environment: dependencies.environment,
      clock: dependencies.clock,
      raceId: raceId(job),
      ...(options.disablePreviousViewers === undefined
        ? {}
        : { disablePreviousViewers: options.disablePreviousViewers }),
    });
  };
  const cleanupCancelledRace = async (job: ScheduledJob): Promise<void> => {
    const id = raceId(job);
    const version = cancellationRaceVersion(job);
    if (version === undefined) throw new Error('Cancellation cleanup raceVersion is missing.');
    const race = gameStore.getRace(id);
    if (race.version !== version || race.status !== 'cancelled') return;
    if (dependencies.discordClient === undefined) return;
    const messages = new SqliteDiscordMessageStore(dependencies.database, () =>
      dependencies.clock.now(),
    );
    if (
      messages.get('race', id) !== undefined &&
      dependencies.environment.DISCORD_RACE_CHANNEL_ID !== undefined
    ) {
      await publishRaceMessage({
        client: dependencies.discordClient,
        database: dependencies.database,
        environment: dependencies.environment,
        clock: dependencies.clock,
        raceId: id,
      });
    }
    const reminder = messages.get('race_reminder', id);
    if (reminder === undefined) return;
    await deleteRaceStartReminder({
      client: dependencies.discordClient,
      channelId: reminder.channelId,
      messageId: reminder.messageId,
    });
    messages.remove('race_reminder', id);
  };

  return {
    async grant_racing_role(job) {
      const discordUserId = job.payload.discordUserId;
      if (typeof discordUserId !== 'string' || !/^\d+$/.test(discordUserId)) {
        throw new Error('Job discordUserId is invalid.');
      }
      if (
        dependencies.discordClient === undefined ||
        dependencies.environment.DISCORD_GUILD_ID === undefined ||
        dependencies.environment.DISCORD_RACING_ROLE_ID === undefined
      ) {
        return;
      }
      await assignRacingRole({
        client: dependencies.discordClient,
        guildId: dependencies.environment.DISCORD_GUILD_ID,
        roleId: dependencies.environment.DISCORD_RACING_ROLE_ID,
        discordUserId,
      });
    },
    async simulate_race(job) {
      if (!isCurrentRaceJob(job)) return;
      const id = raceId(job);
      const raceBeforePreparation = gameStore.getRace(id);
      const prepared = loadPreparedRaceTiming(
        dependencies.database,
        id,
        raceBeforePreparation.version,
      );
      let timelineDurationMs: number;
      if (prepared !== undefined) {
        timelineDurationMs = prepared.timelineDurationMs;
      } else {
        const seedPlan = gameStore.planSeedLiquidity(id);
        await sendAdminNotice(dependencies, {
          level: 'info',
          title: 'レースのシミュレーションを開始しました',
          fields: [{ name: 'レースID', value: id }],
        });
        let completion;
        try {
          completion = await prepareRace(id, {
            repository: new SqliteRacePreparationRepository(
              dependencies.database,
              () => dependencies.clock.now(),
              resultMasterSecrets,
            ),
            probabilityGenerator: new WorkerProbabilityGenerator(),
            timelineMasterSecret: timelineMasterSecrets[0]!,
            resultMasterSecret: resultMasterSecrets[0]!,
            manifestPrivateKey,
            seedLiquidity: seedPlan.liquidity,
          });
        } catch (error) {
          await sendAdminNotice(dependencies, {
            level: 'error',
            title: 'レースのシミュレーションに失敗しました',
            description: 'エラー内容を確認してください。',
            fields: [
              { name: 'レースID', value: id },
              {
                name: 'エラー内容',
                value:
                  error instanceof Error
                    ? error.message.slice(0, 160)
                    : '原因を特定できませんでした。',
              },
            ],
          });
          throw error;
        }
        await sendAdminNotice(dependencies, {
          level: 'success',
          title: 'レースのシミュレーションが完了しました',
          description: '観戦用データを保存しました。',
          fields: [
            { name: 'レースID', value: id },
            { name: '保存先', value: 'R2', inline: true },
          ],
        });
        const residentSetBytes = process.memoryUsage().rss;
        if (residentSetBytes >= 430 * 1_024 * 1_024) {
          await sendAdminNotice(dependencies, {
            level: 'warning',
            title: 'サーバーのメモリ使用量が高くなっています',
            description: 'シミュレーション後の使用量が警告水準を超えました。',
            fields: [
              { name: 'レースID', value: id },
              {
                name: '使用量',
                value: `約 ${String(Math.round(residentSetBytes / 1_024 / 1_024))} MiB`,
              },
            ],
          });
        }
        timelineDurationMs = completion.official.timelineDurationMs;
      }
      enqueueRaceFollowUpJobs(
        jobStore,
        gameStore.getRace(id),
        timelineDurationMs,
        dependencies.clock.now(),
      );
    },
    publish_race: publish,
    async notify_race_start(job) {
      if (!isCurrentRaceJob(job)) return;
      if (
        dependencies.discordClient === undefined ||
        dependencies.environment.DISCORD_RACE_CHANNEL_ID === undefined ||
        dependencies.environment.DISCORD_RACING_ROLE_ID === undefined
      ) {
        return;
      }
      const id = raceId(job);
      const race = gameStore.getRace(id);
      if (!['locked', 'betting_open', 'betting_closed', 'ready'].includes(race.status)) {
        return;
      }
      const version = raceVersion(job);
      if (version === undefined) throw new Error('Job raceVersion is missing.');
      const messages = new SqliteDiscordMessageStore(dependencies.database, () =>
        dependencies.clock.now(),
      );
      if (messages.get('race_reminder', id) !== undefined) return;
      const sent = await sendRaceStartReminder({
        client: dependencies.discordClient,
        channelId: dependencies.environment.DISCORD_RACE_CHANNEL_ID,
        roleId: dependencies.environment.DISCORD_RACING_ROLE_ID,
        raceId: id,
        raceVersion: version,
      });
      messages.save({
        purpose: 'race_reminder',
        raceId: id,
        channelId: sent.channelId,
        messageId: sent.messageId,
      });
    },
    async refresh_race_message(job) {
      if (job.payload.cancellationCleanup === true) {
        await cleanupCancelledRace(job);
        return;
      }
      await publish(job);
    },
    async open_viewer(job) {
      await publish(job, { disablePreviousViewers: true });
    },
    async close_betting(job) {
      if (!isCurrentRaceJob(job)) return;
      const id = raceId(job);
      lifecycle.closeBetting(id, dependencies.clock.now());
      lifecycle.markReady(id);
      await publish(job);
    },
    async mark_running(job) {
      if (!isCurrentRaceJob(job)) return;
      lifecycle.markRunning(raceId(job), dependencies.clock.now());
      await publish(job);
    },
    async mark_finished(job) {
      if (!isCurrentRaceJob(job)) return;
      lifecycle.markFinished(raceId(job), dependencies.clock.now());
    },
    async settle_race(job) {
      if (!isCurrentRaceJob(job)) return;
      const id = raceId(job);
      const version = raceVersion(job) ?? gameStore.getRace(id).version;
      lifecycle.settleRace(id, dependencies.clock.now());
      const rankingKey = `rankings:${id}:${String(version)}`;
      if (jobStore.getByDeduplicationKey(rankingKey) === undefined) {
        jobStore.enqueue({
          jobType: 'refresh_rankings',
          deduplicationKey: rankingKey,
          payload: { raceId: id },
          runAt: dependencies.clock.now(),
        });
      }
      await publish(job);
      if (dependencies.discordClient !== undefined) {
        const messages = new SqliteDiscordMessageStore(dependencies.database, () =>
          dependencies.clock.now(),
        );
        const reminder = messages.get('race_reminder', id);
        if (reminder !== undefined) {
          await deleteRaceStartReminder({
            client: dependencies.discordClient,
            channelId: reminder.channelId,
            messageId: reminder.messageId,
          });
          messages.remove('race_reminder', id);
        }
      }
      await sendAdminNotice(dependencies, {
        level: 'success',
        title: 'レースの精算が完了しました',
        description: '払戻と残高を更新しました。',
        fields: [{ name: 'レースID', value: id }],
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
          reason: 'Central bank balance is below 2,000,000 CP.',
          after: { balance: health.centralBankBalance },
        });
        await sendAdminNotice(dependencies, {
          level: 'warning',
          title: '中央銀行の残高が少なくなっています',
          description: '残高が警告水準を下回りました。',
          fields: [
            {
              name: '現在の残高',
              value: `${BigInt(health.centralBankBalance).toLocaleString('ja-JP')} CP`,
            },
            { name: '警告水準', value: '2,000,000 CP', inline: true },
          ],
        });
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
        await sendAdminNotice(dependencies, {
          level: 'warning',
          title: '本日のレースがまだ作成されていません',
          description: 'レース作成画面を確認してください。',
          fields: [{ name: '対象日', value: formatDateKeyForDisplay(date) }],
        });
      }
    },
    async refresh_rankings() {
      if (dependencies.discordClient === undefined) return;
      if (dependencies.environment.DISCORD_RANKING_CHANNEL_ID !== undefined) {
        await publishRankingMessages({
          client: dependencies.discordClient,
          database: dependencies.database,
          clock: dependencies.clock,
          channelId: dependencies.environment.DISCORD_RANKING_CHANNEL_ID,
        });
      }
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
        await sendAdminNotice(dependencies, {
          level: 'error',
          title: 'バックアップの確認に失敗しました',
          description: 'R2バックアップの状態を確認してください。',
          fields: [{ name: '詳細', value: reason }],
        });
        throw error;
      }
    },
    async restore_drill() {
      if (dependencies.environment.NODE_ENV !== 'production') return;
      const month = toJstDateKey(dependencies.clock.now()).slice(0, 7);
      const nextMonth = nextMonthKey(month);
      jobStore.enqueue({
        jobType: 'restore_drill',
        deduplicationKey: `restore-drill:${nextMonth}`,
        payload: { month: nextMonth },
        runAt: jstDateTimeToTimestamp(`${nextMonth}-01`, '03:00:00'),
      });
      await execFileAsync('/app/scripts/restore-drill.sh', [], {
        env: process.env,
        timeout: 15 * 60 * 1_000,
        maxBuffer: 2 * 1_024 * 1_024,
      });
    },
  };
}
