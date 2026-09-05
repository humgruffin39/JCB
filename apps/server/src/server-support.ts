import { createHash, randomInt } from 'node:crypto';
import type { Environment } from '@jcb/config';
import { jstDateTimeToTimestamp, timestamp, toJstDateKey } from '@jcb/domain';
import type { DomainError } from '@jcb/domain';
import type { SqliteDatabase } from '@jcb/database';
import type { FastifyRequest } from 'fastify';

export function envelope<Result>(result: Result): {
  readonly apiVersion: 'v1';
  readonly result: Result;
} {
  return { apiVersion: 'v1', result };
}

export function secureRandomUnit(): number {
  return randomInt(0, 4_294_967_296) / 4_294_967_296;
}

export function requireRuntimeSecrets(
  value: string | undefined,
  previousValue: string | undefined,
  nodeEnvironment: string,
  name: string,
): readonly string[] {
  if (value !== undefined) {
    return previousValue === undefined || previousValue === value
      ? [value]
      : [value, previousValue];
  }
  if (nodeEnvironment === 'production') throw new Error(`${name} is required.`);
  return [Buffer.alloc(32, 7).toString('base64')];
}

export function requireRuntimeSecret(
  value: string | undefined,
  nodeEnvironment: string,
  name: string,
): string {
  return requireRuntimeSecrets(value, undefined, nodeEnvironment, name)[0]!;
}

export function httpError(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

export function domainErrorStatus(error: DomainError): number {
  switch (error.code) {
    case 'INVALID_MONEY':
    case 'INVALID_TIMESTAMP':
    case 'INVALID_RACE_ENTRY':
    case 'INVALID_HORSE':
    case 'INVALID_SELECTION':
      return 400;
    default:
      return 409;
  }
}

export function findInternalUserId(database: SqliteDatabase, discordUserId: string): string {
  const row = database
    .prepare('SELECT id FROM users WHERE discord_user_id = ?')
    .get(discordUserId) as { id: string } | undefined;
  if (row === undefined) throw new Error('Authenticated user is not registered.');
  return row.id;
}

export function findOptionalInternalUserId(
  database: SqliteDatabase,
  discordUserId: string,
): string | undefined {
  const row = database
    .prepare('SELECT id FROM users WHERE discord_user_id = ?')
    .get(discordUserId) as { id: string } | undefined;
  return row?.id;
}

export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${ip}`).digest('hex');
}

/**
 * The caller address as observed by infrastructure we control.
 *
 * `X-Forwarded-For` is appended to by every hop including the client, so it can
 * never identify a caller on its own. Fly's proxy overwrites `Fly-Client-IP` on
 * every request, which makes it the one address a caller cannot choose.
 */
export function clientAddress(request: FastifyRequest): string {
  const header = request.headers['fly-client-ip'];
  const flyClientIp = Array.isArray(header) ? header[0] : header;
  if (typeof flyClientIp === 'string' && flyClientIp.trim() !== '') return flyClientIp.trim();
  return request.ip;
}

export function withoutUndefined(input: object): object {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function rescheduleMissingRaceWarnings(
  database: SqliteDatabase,
  now: number,
  timeOfDay: string,
): void {
  for (const offset of [0, 1]) {
    const currentDate = toJstDateKey(timestamp(now));
    const date = toJstDateKey(
      timestamp(Date.parse(`${currentDate}T00:00:00+09:00`) + offset * 24 * 60 * 60 * 1_000),
    );
    const scheduled = jstDateTimeToTimestamp(date, timeOfDay);
    database
      .prepare(
        `UPDATE scheduled_jobs SET run_at = ?, updated_at = ?
         WHERE deduplication_key = ? AND status IN ('pending', 'retry_wait')`,
      )
      .run(BigInt(scheduled < now ? now : scheduled), BigInt(now), `warn-missing-race:${date}`);
  }
}

export function oauthConfiguration(environment: Environment): {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
} {
  const clientId = environment.DISCORD_CLIENT_ID;
  const clientSecret = environment.DISCORD_CLIENT_SECRET;
  const redirectUri = environment.DISCORD_REDIRECT_URI;
  if (clientId === undefined || clientSecret === undefined || redirectUri === undefined) {
    throw httpError(503, 'DISCORD_OAUTH_UNAVAILABLE', 'Discord OAuth is not configured.');
  }
  return { clientId, clientSecret, redirectUri };
}
