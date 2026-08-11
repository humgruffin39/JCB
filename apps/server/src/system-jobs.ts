import { DEFAULT_GAME_SETTINGS, gameSettingsSchema } from '@jcb/config';
import { SqliteJobStore, type SqliteDatabase } from '@jcb/database';
import { jstDateTimeToTimestamp, timestamp, toJstDateKey, type Timestamp } from '@jcb/domain';

export function scheduleSystemJobs(sqlite: SqliteDatabase, now: Timestamp): void {
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
      const existing = jobs.getByDeduplicationKey(definition.key);
      jobs.enqueue({
        jobType: definition.jobType,
        deduplicationKey: definition.key,
        payload: { jstDate: date },
        // Preserve a catch-up run time from an earlier boot so the same logical
        // job remains idempotent across restarts.
        runAt: existing?.runAt ?? (scheduled < now ? now : scheduled),
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
