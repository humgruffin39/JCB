/// <reference types="@cloudflare/workers-types" />

import {
  raceIdParamsSchema,
  signedManifestSchema,
  type edgeAccessClaimsSchema,
} from '@jcb/contracts';
import { ZodError, type z } from 'zod';
import {
  bytesToBase64,
  deriveTimelineKey,
  deriveVerifiedTimelineKey,
  sha256Hex,
  verifyAccessToken,
  verifyManifest,
} from './edge-crypto.js';

const MAX_EDGE_TOKEN_LENGTH = 8_192;

class EdgeRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

interface StoredObject {
  readonly body: ReadableStream;
  readonly customMetadata?: Record<string, string>;
  json(): Promise<unknown>;
}

interface ReadableBucket {
  get(key: string): Promise<StoredObject | null>;
}

export interface Bindings {
  readonly TIMELINE_BUCKET: ReadableBucket;
  readonly TIMELINE_MASTER_SECRET: string;
  readonly TIMELINE_MASTER_SECRET_PREVIOUS?: string;
  readonly EDGE_TOKEN_PUBLIC_KEY: string;
  readonly MANIFEST_PUBLIC_KEY: string;
  readonly DISCORD_GUILD_ID: string;
  readonly WEB_ORIGIN: string;
}

export async function handleEdgeRequest(
  request: Request,
  environment: Bindings,
): Promise<Response> {
  const allowedOrigins = configuredOrigins(environment.WEB_ORIGIN);
  let responseOrigin = allowedOrigins[0]!;
  try {
    const requestOrigin = request.headers.get('origin');
    responseOrigin = selectResponseOrigin(requestOrigin, allowedOrigins);
    if (requestOrigin !== null && !allowedOrigins.includes(requestOrigin)) {
      return errorResponse(403, 'ORIGIN_NOT_ALLOWED', responseOrigin);
    }
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(responseOrigin);
      headers.set('access-control-allow-methods', 'GET, OPTIONS');
      headers.set('access-control-allow-headers', 'authorization');
      headers.set('access-control-max-age', '86400');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return errorResponse(405, 'METHOD_NOT_ALLOWED', responseOrigin);
    }
    const url = new URL(request.url);
    const match = /^\/edge\/v1\/races\/([^/]+)\/(release|timeline)$/.exec(url.pathname);
    if (match === null) return errorResponse(404, 'NOT_FOUND', responseOrigin);
    let raceId: string;
    try {
      raceId = raceIdParamsSchema.parse({ raceId: decodeURIComponent(match[1]!) }).raceId;
    } catch {
      throw new EdgeRequestError(400, 'INVALID_RACE_ID');
    }
    const token = bearerToken(request);
    let claims: z.infer<typeof edgeAccessClaimsSchema>;
    try {
      claims = await verifyAccessToken(
        token,
        environment.EDGE_TOKEN_PUBLIC_KEY,
        Math.floor(Date.now() / 1000),
      );
    } catch {
      throw new EdgeRequestError(401, 'TOKEN_INVALID');
    }
    if (claims.raceId !== raceId || claims.guildId !== environment.DISCORD_GUILD_ID) {
      return errorResponse(403, 'TOKEN_SCOPE_MISMATCH', responseOrigin);
    }
    const manifestObject = await environment.TIMELINE_BUCKET.get(`race-manifests/${raceId}.json`);
    if (manifestObject === null) {
      return errorResponse(503, 'MANIFEST_UNAVAILABLE', responseOrigin);
    }
    let manifest: z.infer<typeof signedManifestSchema>['manifest'];
    try {
      const signedManifest = signedManifestSchema.parse(await manifestObject.json());
      manifest = await verifyManifest(signedManifest, environment.MANIFEST_PUBLIC_KEY);
    } catch {
      throw new EdgeRequestError(409, 'MANIFEST_INVALID');
    }
    if (manifest.raceId !== raceId) {
      return errorResponse(409, 'MANIFEST_RACE_MISMATCH', responseOrigin);
    }
    if (Date.now() < (manifest.viewerOpensAt ?? manifest.scheduledStart)) {
      return errorResponse(425, 'RACE_NOT_STARTED', responseOrigin);
    }
    const timelineObject = await environment.TIMELINE_BUCKET.get(manifest.ciphertextObjectKey);
    if (timelineObject === null) {
      return errorResponse(503, 'TIMELINE_UNAVAILABLE', responseOrigin);
    }
    const timelineMetadata = Object.fromEntries(
      Object.entries(timelineObject.customMetadata ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    if (
      timelineMetadata.sha256 !== manifest.ciphertextSha256 ||
      timelineMetadata.raceid !== raceId
    ) {
      return errorResponse(409, 'TIMELINE_METADATA_INVALID', responseOrigin);
    }
    const headers = corsHeaders(responseOrigin);
    headers.set('cache-control', 'private, max-age=60');
    if (match[2] === 'timeline') {
      const timelineBytes = await new Response(timelineObject.body).arrayBuffer();
      if ((await sha256Hex(timelineBytes)) !== manifest.ciphertextSha256) {
        return errorResponse(409, 'TIMELINE_INTEGRITY_INVALID', responseOrigin);
      }
      headers.set('content-type', 'application/octet-stream');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(timelineBytes, { status: 200, headers });
    }
    let timelineKey: Uint8Array;
    if (environment.TIMELINE_MASTER_SECRET_PREVIOUS === undefined) {
      timelineKey = await deriveTimelineKey(
        environment.TIMELINE_MASTER_SECRET,
        raceId,
        manifest.simulationVersion,
        manifest.raceVersion,
      );
    } else {
      try {
        timelineKey = await deriveVerifiedTimelineKey(
          [environment.TIMELINE_MASTER_SECRET, environment.TIMELINE_MASTER_SECRET_PREVIOUS],
          raceId,
          manifest.simulationVersion,
          manifest.raceVersion,
          manifest.iv,
          manifest.authTag,
          await new Response(timelineObject.body).arrayBuffer(),
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMELINE_KEY_INVALID') {
          throw new EdgeRequestError(409, 'TIMELINE_KEY_INVALID');
        }
        throw error;
      }
    }
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(
      JSON.stringify({
        apiVersion: 'v1',
        result: {
          raceId,
          raceVersion: manifest.raceVersion,
          scheduledStart: manifest.scheduledStart,
          viewerOpensAt: manifest.viewerOpensAt ?? manifest.scheduledStart,
          timelineDuration: manifest.timelineDuration,
          timelineKey: bytesToBase64(timelineKey),
          iv: manifest.iv,
          authTag: manifest.authTag,
          codecVersion: manifest.codecVersion,
          timelinePath: `/edge/v1/races/${encodeURIComponent(raceId)}/timeline`,
        },
      }),
      { status: 200, headers },
    );
  } catch (error) {
    if (error instanceof EdgeRequestError) {
      return errorResponse(error.status, error.code, responseOrigin);
    }
    if (error instanceof ZodError) {
      return errorResponse(400, 'VALIDATION_FAILED', responseOrigin);
    }
    return errorResponse(500, 'EDGE_REQUEST_FAILED', responseOrigin);
  }
}

const edgeWorker = {
  async fetch(request: Request, environment: Bindings): Promise<Response> {
    return await handleEdgeRequest(request, environment);
  },
};

export default edgeWorker;

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (authorization === null) {
    throw new EdgeRequestError(401, 'TOKEN_REQUIRED');
  }
  const parts = authorization.trim().split(/\s+/);
  const scheme = parts[0];
  const token = parts[1];
  if (
    parts.length !== 2 ||
    scheme?.toLowerCase() !== 'bearer' ||
    token === undefined ||
    token.length === 0
  ) {
    throw new EdgeRequestError(401, 'TOKEN_REQUIRED');
  }
  if (token.length > MAX_EDGE_TOKEN_LENGTH) {
    throw new EdgeRequestError(401, 'TOKEN_INVALID');
  }
  return token;
}

function errorResponse(status: number, code: string, origin: string): Response {
  const headers = corsHeaders(origin);
  headers.set('cache-control', 'no-store');
  return Response.json(
    { apiVersion: 'v1', error: { code, message: code.replaceAll('_', ' ') } },
    { status, headers },
  );
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  });
}

function configuredOrigins(value: string): readonly string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length === 0 ? [value] : origins;
}

function selectResponseOrigin(
  requestOrigin: string | null,
  allowedOrigins: readonly string[],
): string {
  if (requestOrigin !== null && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return allowedOrigins[0]!;
}
