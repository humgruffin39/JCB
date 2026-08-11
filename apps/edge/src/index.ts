/// <reference types="@cloudflare/workers-types" />

import { edgeAccessClaimsSchema, raceIdParamsSchema, signedManifestSchema } from '@jcb/contracts';
import { ZodError, type z } from 'zod';

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
  readonly EDGE_TOKEN_PUBLIC_KEY: string;
  readonly MANIFEST_PUBLIC_KEY: string;
  readonly DISCORD_GUILD_ID: string;
  readonly WEB_ORIGIN: string;
}

export async function handleEdgeRequest(
  request: Request,
  environment: Bindings,
): Promise<Response> {
  try {
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin !== null && requestOrigin !== environment.WEB_ORIGIN) {
      return errorResponse(403, 'ORIGIN_NOT_ALLOWED', environment.WEB_ORIGIN);
    }
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(environment.WEB_ORIGIN);
      headers.set('access-control-allow-methods', 'GET, OPTIONS');
      headers.set('access-control-allow-headers', 'authorization');
      headers.set('access-control-max-age', '86400');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return errorResponse(405, 'METHOD_NOT_ALLOWED', environment.WEB_ORIGIN);
    }
    const url = new URL(request.url);
    const match = /^\/edge\/v1\/races\/([^/]+)\/(release|timeline)$/.exec(url.pathname);
    if (match === null) return errorResponse(404, 'NOT_FOUND', environment.WEB_ORIGIN);
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
      return errorResponse(403, 'TOKEN_SCOPE_MISMATCH', environment.WEB_ORIGIN);
    }
    const manifestObject = await environment.TIMELINE_BUCKET.get(`race-manifests/${raceId}.json`);
    if (manifestObject === null) {
      return errorResponse(503, 'MANIFEST_UNAVAILABLE', environment.WEB_ORIGIN);
    }
    let manifest: z.infer<typeof signedManifestSchema>['manifest'];
    try {
      const signedManifest = signedManifestSchema.parse(await manifestObject.json());
      manifest = await verifyManifest(signedManifest, environment.MANIFEST_PUBLIC_KEY);
    } catch {
      throw new EdgeRequestError(409, 'MANIFEST_INVALID');
    }
    if (manifest.raceId !== raceId) {
      return errorResponse(409, 'MANIFEST_RACE_MISMATCH', environment.WEB_ORIGIN);
    }
    if (Date.now() < manifest.scheduledStart) {
      return errorResponse(425, 'RACE_NOT_STARTED', environment.WEB_ORIGIN);
    }
    const timelineObject = await environment.TIMELINE_BUCKET.get(manifest.ciphertextObjectKey);
    if (timelineObject === null) {
      return errorResponse(503, 'TIMELINE_UNAVAILABLE', environment.WEB_ORIGIN);
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
      return errorResponse(409, 'TIMELINE_METADATA_INVALID', environment.WEB_ORIGIN);
    }
    const headers = corsHeaders(environment.WEB_ORIGIN);
    headers.set('cache-control', 'private, max-age=60');
    if (match[2] === 'timeline') {
      const timelineBytes = await new Response(timelineObject.body).arrayBuffer();
      if ((await sha256Hex(timelineBytes)) !== manifest.ciphertextSha256) {
        return errorResponse(409, 'TIMELINE_INTEGRITY_INVALID', environment.WEB_ORIGIN);
      }
      headers.set('content-type', 'application/octet-stream');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(timelineBytes, { status: 200, headers });
    }
    const timelineKey = await deriveTimelineKey(
      environment.TIMELINE_MASTER_SECRET,
      raceId,
      manifest.simulationVersion,
      manifest.raceVersion,
    );
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(
      JSON.stringify({
        apiVersion: 'v1',
        result: {
          raceId,
          raceVersion: manifest.raceVersion,
          scheduledStart: manifest.scheduledStart,
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
      return errorResponse(error.status, error.code, environment.WEB_ORIGIN);
    }
    if (error instanceof ZodError) {
      return errorResponse(400, 'VALIDATION_FAILED', environment.WEB_ORIGIN);
    }
    return errorResponse(500, 'EDGE_REQUEST_FAILED', environment.WEB_ORIGIN);
  }
}

const edgeWorker = {
  async fetch(request: Request, environment: Bindings): Promise<Response> {
    return await handleEdgeRequest(request, environment);
  },
};

export default edgeWorker;

async function verifyAccessToken(
  token: string,
  publicKeyValue: string,
  nowSeconds: number,
): Promise<z.infer<typeof edgeAccessClaimsSchema>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('TOKEN_MALFORMED');
  const [header, payload, signature] = parts as [string, string, string];
  const parsedHeader = JSON.parse(base64UrlToText(header)) as unknown;
  if (
    typeof parsedHeader !== 'object' ||
    parsedHeader === null ||
    !('alg' in parsedHeader) ||
    parsedHeader.alg !== 'EdDSA'
  ) {
    throw new Error('TOKEN_ALGORITHM_INVALID');
  }
  const key = await importEd25519PublicKey(publicKeyValue);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    key,
    webBuffer(base64UrlToBytes(signature)),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error('TOKEN_SIGNATURE_INVALID');
  const claims = edgeAccessClaimsSchema.parse(JSON.parse(base64UrlToText(payload)));
  if (nowSeconds < claims.nbf || nowSeconds >= claims.exp) throw new Error('TOKEN_EXPIRED');
  return claims;
}

async function verifyManifest(
  signedInput: z.infer<typeof signedManifestSchema>,
  publicKeyValue: string,
): Promise<z.infer<typeof signedManifestSchema>['manifest']> {
  const signed = signedManifestSchema.parse(signedInput);
  const key = await importEd25519PublicKey(publicKeyValue);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    key,
    webBuffer(base64UrlToBytes(signed.signature)),
    new TextEncoder().encode(stableStringify(signed.manifest)),
  );
  if (!valid) throw new Error('MANIFEST_SIGNATURE_INVALID');
  return signed.manifest;
}

async function deriveTimelineKey(
  masterSecret: string,
  raceId: string,
  simulationVersion: string,
  raceVersion: number,
): Promise<Uint8Array> {
  const inputKeyMaterial = base64ToBytes(masterSecret);
  if (inputKeyMaterial.byteLength < 32) throw new Error('TIMELINE_SECRET_INVALID');
  const key = await crypto.subtle.importKey('raw', webBuffer(inputKeyMaterial), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(raceId),
      info: new TextEncoder().encode(`timeline:${simulationVersion}:${String(raceVersion)}`),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function importEd25519PublicKey(value: string): Promise<CryptoKey> {
  const normalized = value.includes('BEGIN PUBLIC KEY')
    ? value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
    : value;
  return await crypto.subtle.importKey(
    'spki',
    webBuffer(base64ToBytes(normalized)),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (authorization === null || !authorization.startsWith('Bearer ')) {
    throw new EdgeRequestError(401, 'TOKEN_REQUIRED');
  }
  return authorization.slice('Bearer '.length);
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function base64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replaceAll('-', '+').replaceAll('_', '/'));
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function webBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
