import { assertSnowflake } from '../utilities/snowflake.js';

export type FailureActionStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export interface PendingFailure {
  readonly failedMessageId: string;
  readonly failedUserId: string;
  readonly timeoutUntil: string;
  readonly roleStatus: FailureActionStatus;
  readonly timeoutStatus: FailureActionStatus;
  readonly announcementStatus: FailureActionStatus;
  readonly announcementMessageId: string | null;
}

export interface BotState {
  readonly version: 1;
  readonly guildId: string;
  readonly channelId: string;
  readonly currentCount: string;
  readonly bestCount: string;
  readonly failureCounts: Readonly<Record<string, string>>;
  readonly successfulCounts: Readonly<Record<string, string>>;
  readonly appliedHistoryImports: readonly string[];
  readonly lastProcessedMessageId: string | null;
  readonly lastAcceptedMessageId: string | null;
  readonly lastCounterUserId: string | null;
  readonly pendingFailures: readonly PendingFailure[];
  readonly updatedAt: string;
}

const decimalPattern = /^(0|[1-9][0-9]*)$/;
const positiveDecimalPattern = /^[1-9][0-9]*$/;
const actionStatuses = new Set<FailureActionStatus>(['pending', 'succeeded', 'failed', 'skipped']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`State field ${key} must be a string`);
  }
  return value;
}

function nullableSnowflake(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`State field ${key} must be a snowflake or null`);
  }
  assertSnowflake(value, key);
  return value;
}

function actionStatus(record: Record<string, unknown>, key: string): FailureActionStatus {
  const value = record[key];
  if (typeof value !== 'string' || !actionStatuses.has(value as FailureActionStatus)) {
    throw new Error(`State field ${key} has an invalid action status`);
  }
  return value as FailureActionStatus;
}

function parsePendingFailure(value: unknown): PendingFailure {
  if (!isRecord(value)) {
    throw new Error('pendingFailures contains a non-object value');
  }

  const failedMessageId = stringField(value, 'failedMessageId');
  const failedUserId = stringField(value, 'failedUserId');
  assertSnowflake(failedMessageId, 'failedMessageId');
  assertSnowflake(failedUserId, 'failedUserId');

  const timeoutUntil = stringField(value, 'timeoutUntil');
  if (!Number.isFinite(Date.parse(timeoutUntil))) {
    throw new Error('Pending failure timeoutUntil is not a valid timestamp');
  }

  return {
    failedMessageId,
    failedUserId,
    timeoutUntil,
    roleStatus: actionStatus(value, 'roleStatus'),
    timeoutStatus: actionStatus(value, 'timeoutStatus'),
    announcementStatus: actionStatus(value, 'announcementStatus'),
    announcementMessageId: nullableSnowflake(value, 'announcementMessageId'),
  };
}

function parseUserCounts(
  value: unknown,
  fieldName: 'failureCounts' | 'successfulCounts',
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const counts: Record<string, string> = {};
  for (const [userId, count] of Object.entries(value)) {
    assertSnowflake(userId, `${fieldName} user ID`);
    if (typeof count !== 'string' || !positiveDecimalPattern.test(count)) {
      throw new Error(`${fieldName} values must be canonical positive decimal strings`);
    }
    counts[userId] = count;
  }
  return counts;
}

function parseAppliedHistoryImports(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('appliedHistoryImports must be an array of non-empty strings');
  }
  const imports: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error('appliedHistoryImports must be an array of non-empty strings');
    }
    imports.push(entry);
  }
  if (new Set(imports).size !== imports.length) {
    throw new Error('appliedHistoryImports contains duplicate IDs');
  }
  return imports;
}

export function parseState(value: unknown): BotState {
  if (!isRecord(value)) {
    throw new Error('State must be a JSON object');
  }
  if (value.version !== 1) {
    throw new Error('Unsupported state version');
  }

  const guildId = stringField(value, 'guildId');
  const channelId = stringField(value, 'channelId');
  assertSnowflake(guildId, 'guildId');
  assertSnowflake(channelId, 'channelId');

  const currentCount = stringField(value, 'currentCount');
  if (!decimalPattern.test(currentCount)) {
    throw new Error('currentCount must be a canonical non-negative decimal integer');
  }
  const bestCount = value.bestCount === undefined ? currentCount : stringField(value, 'bestCount');
  if (!decimalPattern.test(bestCount)) {
    throw new Error('bestCount must be a canonical non-negative decimal integer');
  }
  if (BigInt(bestCount) < BigInt(currentCount)) {
    throw new Error('bestCount cannot be lower than currentCount');
  }

  if (!Array.isArray(value.pendingFailures)) {
    throw new Error('pendingFailures must be an array');
  }
  const pendingFailures = value.pendingFailures.map(parsePendingFailure);
  const failureIds = new Set(pendingFailures.map((failure) => failure.failedMessageId));
  if (failureIds.size !== pendingFailures.length) {
    throw new Error('pendingFailures contains duplicate message IDs');
  }

  const updatedAt = stringField(value, 'updatedAt');
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('updatedAt is not a valid timestamp');
  }

  return {
    version: 1,
    guildId,
    channelId,
    currentCount,
    bestCount,
    failureCounts: parseUserCounts(value.failureCounts, 'failureCounts'),
    successfulCounts: parseUserCounts(value.successfulCounts, 'successfulCounts'),
    appliedHistoryImports: parseAppliedHistoryImports(value.appliedHistoryImports),
    lastProcessedMessageId: nullableSnowflake(value, 'lastProcessedMessageId'),
    lastAcceptedMessageId: nullableSnowflake(value, 'lastAcceptedMessageId'),
    lastCounterUserId: nullableSnowflake(value, 'lastCounterUserId'),
    pendingFailures,
    updatedAt,
  };
}

export function serializeState(state: BotState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function createInitialState(input: {
  readonly guildId: string;
  readonly channelId: string;
  readonly initialCount: string;
  readonly latestMessageId: string | null;
  readonly now?: Date;
}): BotState {
  const state: BotState = {
    version: 1,
    guildId: input.guildId,
    channelId: input.channelId,
    currentCount: input.initialCount,
    bestCount: input.initialCount,
    failureCounts: {},
    successfulCounts: {},
    appliedHistoryImports: [],
    lastProcessedMessageId: input.latestMessageId,
    lastAcceptedMessageId: null,
    lastCounterUserId: null,
    pendingFailures: [],
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  return parseState(state);
}
