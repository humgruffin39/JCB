import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Environment } from '@jcb/config';
import { DomainError } from '@jcb/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
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
    trustProxy: true,
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
  });
  return app;
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
    const infrastructureReady =
      dependencies.environment.NODE_ENV !== 'production' ||
      (health.schedulerStatus === 'nominal' &&
        health.r2AccessStatus === 'nominal' &&
        (dependencies.discordStatus?.() ?? false));
    const ready = health.ledgerProjectionValid && health.databaseReadWrite && infrastructureReady;
    if (!ready) void reply.status(503);
    return {
      status: ready ? 'ready' : 'not_ready',
      ledgerProjectionValid: health.ledgerProjectionValid,
      databaseReadWrite: health.databaseReadWrite,
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
