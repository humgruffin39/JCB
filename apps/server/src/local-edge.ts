import {
  decryptAesGcm,
  deriveTimelineKey,
  sha256,
  verifyEdgeAccessToken,
  verifyReleaseManifest,
  type PrivateObjectStore,
} from '@jcb/application';
import type { Environment } from '@jcb/config';
import { raceIdParamsSchema, signedManifestSchema } from '@jcb/contracts';
import type { SqliteDatabase } from '@jcb/database';
import type { Clock } from '@jcb/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';

export function registerLocalEdgeRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly environment: Environment;
    readonly clock: Clock;
    readonly timelineStore: PrivateObjectStore;
    readonly database: SqliteDatabase;
  },
): void {
  if (dependencies.environment.NODE_ENV === 'production') return;

  app.get('/edge/v1/races/:raceId/release', async (request, reply) => {
    const raceId = parseRaceId(request.params);
    const manifest = await loadManifest(raceId, dependencies);
    const token = verifyToken(request.headers.authorization, dependencies);
    if (token.raceId !== raceId || token.guildId !== dependencies.environment.DISCORD_GUILD_ID) {
      return sendError(reply, 403, 'TOKEN_SCOPE_MISMATCH');
    }
    if (
      dependencies.clock.now() < manifest.scheduledStart &&
      !hasRehearsalStarted(dependencies.database, raceId)
    ) {
      return sendError(reply, 425, 'RACE_NOT_STARTED');
    }
    const ciphertext = await dependencies.timelineStore.get(manifest.ciphertextObjectKey);
    if (ciphertext === undefined) return sendError(reply, 503, 'TIMELINE_UNAVAILABLE');
    if (sha256(ciphertext) !== manifest.ciphertextSha256) {
      return sendError(reply, 409, 'TIMELINE_INTEGRITY_INVALID');
    }
    const masterSecrets = [
      requireConfigured(dependencies.environment.TIMELINE_MASTER_SECRET, 'TIMELINE_MASTER_SECRET'),
      ...(dependencies.environment.TIMELINE_MASTER_SECRET_PREVIOUS === undefined
        ? []
        : [dependencies.environment.TIMELINE_MASTER_SECRET_PREVIOUS]),
    ];
    const payload = {
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      iv: manifest.iv,
      authTag: manifest.authTag,
    };
    let key: Buffer | undefined;
    for (const masterSecret of masterSecrets) {
      const candidate = deriveTimelineKey(
        masterSecret,
        raceId,
        manifest.simulationVersion,
        manifest.raceVersion,
      );
      try {
        decryptAesGcm(payload, candidate);
        key = candidate;
        break;
      } catch {
        continue;
      }
    }
    if (key === undefined) return sendError(reply, 409, 'TIMELINE_KEY_INVALID');
    reply.header('cache-control', 'private, max-age=60');
    return {
      apiVersion: 'v1',
      result: {
        raceId,
        raceVersion: manifest.raceVersion,
        scheduledStart: manifest.scheduledStart,
        timelineDuration: manifest.timelineDuration,
        timelineKey: key.toString('base64'),
        iv: manifest.iv,
        authTag: manifest.authTag,
        codecVersion: manifest.codecVersion,
        timelinePath: `/edge/v1/races/${encodeURIComponent(raceId)}/timeline`,
      },
    };
  });

  app.get('/edge/v1/races/:raceId/timeline', async (request, reply) => {
    const raceId = parseRaceId(request.params);
    const manifest = await loadManifest(raceId, dependencies);
    const token = verifyToken(request.headers.authorization, dependencies);
    if (token.raceId !== raceId || token.guildId !== dependencies.environment.DISCORD_GUILD_ID) {
      return sendError(reply, 403, 'TOKEN_SCOPE_MISMATCH');
    }
    if (
      dependencies.clock.now() < manifest.scheduledStart &&
      !hasRehearsalStarted(dependencies.database, raceId)
    ) {
      return sendError(reply, 425, 'RACE_NOT_STARTED');
    }
    const ciphertext = await dependencies.timelineStore.get(manifest.ciphertextObjectKey);
    if (ciphertext === undefined) return sendError(reply, 503, 'TIMELINE_UNAVAILABLE');
    if (sha256(ciphertext) !== manifest.ciphertextSha256) {
      return sendError(reply, 409, 'TIMELINE_INTEGRITY_INVALID');
    }
    return await reply
      .header('cache-control', 'private, max-age=60')
      .type('application/octet-stream')
      .send(Buffer.from(ciphertext));
  });
}

function parseRaceId(params: unknown): string {
  return raceIdParamsSchema.parse(params).raceId;
}

function hasRehearsalStarted(database: SqliteDatabase, raceId: string): boolean {
  const row = database.prepare('SELECT status FROM races WHERE id = ?').get(raceId) as
    { readonly status: string } | undefined;
  return row !== undefined && ['running', 'finished', 'settling', 'settled'].includes(row.status);
}

function verifyToken(
  authorization: string | undefined,
  dependencies: { readonly environment: Environment; readonly clock: Clock },
) {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    throw unauthorized('TOKEN_REQUIRED');
  }
  try {
    return verifyEdgeAccessToken(
      authorization.slice('Bearer '.length),
      requireConfigured(dependencies.environment.EDGE_TOKEN_PUBLIC_KEY, 'EDGE_TOKEN_PUBLIC_KEY'),
      Math.floor(dependencies.clock.now() / 1000),
    );
  } catch {
    throw unauthorized('TOKEN_INVALID');
  }
}

async function loadManifest(
  raceId: string,
  dependencies: {
    readonly environment: Environment;
    readonly timelineStore: PrivateObjectStore;
  },
) {
  const object = await dependencies.timelineStore.get(`race-manifests/${raceId}.json`);
  if (object === undefined) throw unavailable('MANIFEST_UNAVAILABLE');
  const signed = signedManifestSchema.parse(JSON.parse(Buffer.from(object).toString('utf8')));
  return verifyReleaseManifest(
    signed,
    requireConfigured(dependencies.environment.MANIFEST_PUBLIC_KEY, 'MANIFEST_PUBLIC_KEY'),
  );
}

function sendError(reply: FastifyReply, statusCode: number, code: string): FastifyReply {
  return reply.code(statusCode).send({
    apiVersion: 'v1',
    error: { code, message: code.replaceAll('_', ' ') },
  });
}

function unauthorized(code: string): Error {
  return Object.assign(new Error(code), { statusCode: 401, code });
}

function unavailable(code: string): Error {
  return Object.assign(new Error(code), { statusCode: 503, code });
}

function requireConfigured(value: string | undefined, key: string): string {
  if (value === undefined) throw unavailable(`${key}_NOT_CONFIGURED`);
  return value;
}
