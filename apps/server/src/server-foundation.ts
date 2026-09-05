import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Environment } from '@jcb/config';
import { DomainError } from '@jcb/domain';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { clientAddress } from './server-support.js';
import type { ServerDependencies, ServerRouteContext } from './server-types.js';

export async function createServerApp(environment: Environment): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: environment.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.ticket',
          '*.code',
          '*.accessToken',
          '*.sessionToken',
          '*.officialSeed',
          '*.finishOrder',
        ],
        censor: '[REDACTED]',
      },
    },
    // Every hop, the caller included, may append to `X-Forwarded-For`, so trusting
    // it would let anyone choose their own `request.ip` and with it their own rate
    // limit bucket. Callers are identified by `clientAddress` instead.
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });
  const origins = new Set(
    environment.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  if (environment.DISCORD_CLIENT_ID !== undefined) {
    origins.add(`https://${environment.DISCORD_CLIENT_ID}.discordsays.com`);
  }
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin === undefined || origins.has(origin));
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...origins],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
  });
  return app;
}

const SESSION_COOKIE_PREFIX = 'jcb_';

/**
 * Buckets a caller by their session when they have one, and by the address Fly
 * reports otherwise. Signed-in traffic reaches us through Cloudflare, so every
 * caller would otherwise share one edge address and one another's budget.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const sessionToken = Object.entries(request.cookies as Record<string, string | undefined>)
    .filter(([name, value]) => name.startsWith(SESSION_COOKIE_PREFIX) && value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value)
    .join('|');
  if (sessionToken !== '') {
    return `session:${createHash('sha256').update(sessionToken).digest('hex').slice(0, 32)}`;
  }
  return `address:${clientAddress(request)}`;
}

export function registerFoundationRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
  dependencies: ServerDependencies,
): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({
        apiVersion: 'v1',
        error: { code: 'VALIDATION_FAILED', message: error.issues[0]?.message ?? 'Invalid input.' },
      });
      return;
    }
    const safeError = error instanceof Error ? error : new Error('Unknown request error.');
    const taggedError = safeError as Error & {
      readonly statusCode?: number;
      readonly code?: string;
    };
    const statusCode =
      typeof taggedError.statusCode === 'number'
        ? taggedError.statusCode
        : safeError instanceof DomainError
          ? domainErrorStatus(safeError)
          : 500;
    const code = typeof taggedError.code === 'string' ? taggedError.code : 'INTERNAL_ERROR';
    if (statusCode >= 500) app.log.error({ err: safeError }, 'request failed');
    void reply.status(statusCode).send({
      apiVersion: 'v1',
      error: {
        code,
        message: statusCode >= 500 ? 'Internal server error.' : safeError.message,
      },
    });
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const health = context.adminStore.health();
    // Readiness answers "should this machine keep serving traffic". Discord being
    // down is reported but never fails it, because restarting on their outage
    // takes the site down with them and brings it back no sooner.
    const infrastructureReady =
      dependencies.environment.NODE_ENV !== 'production' ||
      (health.schedulerStatus === 'nominal' && health.r2AccessStatus === 'nominal');
    const ready = health.ledgerProjectionValid && health.databaseReadWrite && infrastructureReady;
    if (!ready) void reply.status(503);
    return {
      status: ready ? 'ready' : 'not_ready',
      ledgerProjectionValid: health.ledgerProjectionValid,
      databaseReadWrite: health.databaseReadWrite,
      discordConnected: dependencies.discordStatus?.() ?? false,
    };
  });
}

function domainErrorStatus(error: DomainError): number {
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
