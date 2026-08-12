import type { PrivateObjectStore } from '@jcb/application';
import type { Environment } from '@jcb/config';
import type { SqliteDatabase } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import type { Client } from 'discord.js';
import type { BackupProbe } from './backup-probe.js';

export interface SchedulerDependencies {
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly timelineStore: PrivateObjectStore;
  readonly backupProbe?: BackupProbe;
  readonly discordClient?: Client;
  readonly onError?: (error: unknown) => void;
}

export interface MissingPublishedObjectRepairResult {
  readonly requeued: readonly string[];
  readonly unrecoverable: readonly string[];
}
