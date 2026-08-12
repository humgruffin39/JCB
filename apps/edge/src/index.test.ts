import { createEdgeAccessToken, signReleaseManifest } from '@jcb/application';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEdgeRequest, type Bindings } from './index.js';

const now = 1_800_000_000_000;
const guildId = '123456789';
const raceId = 'race-edge-test';
const webOrigin = 'https://racing.example.test';
const timelineBody = new Uint8Array([1, 2, 3, 4]);
const timelineSha256 = createHash('sha256').update(timelineBody).digest('hex');
const tokenKeys = generateKeyPairSync('ed25519');
const manifestKeys = generateKeyPairSync('ed25519');
const tokenPrivateKey = tokenKeys.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const tokenPublicKey = tokenKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
});
const manifestPrivateKey = manifestKeys.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const manifestPublicKey = manifestKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
});

afterEach(() => vi.restoreAllMocks());

describe('Cloudflare release edge', () => {
  it('answers browser preflight without requiring a bearer token', async () => {
    const response = await handleEdgeRequest(
      new Request(`https://edge.example.test/edge/v1/races/${raceId}/release`, {
        method: 'OPTIONS',
        headers: { origin: webOrigin },
      }),
      environment(signedManifest(now + 1_000)),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization');
  });

  it('allows each explicitly configured web origin and echoes the requesting origin', async () => {
    const alternateOrigin = 'https://josanism.space';
    const response = await handleEdgeRequest(
      new Request(`https://edge.example.test/edge/v1/races/${raceId}/release`, {
        method: 'OPTIONS',
        headers: {
          origin: alternateOrigin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      }),
      {
        ...environment(signedManifest(now + 1_000)),
        WEB_ORIGIN: `${webOrigin},${alternateOrigin}`,
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(alternateOrigin);
  });

  it('rejects release before the signed scheduled start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await requestRelease(validToken(), environment(signedManifest(now + 1_000)));

    expect(response.status).toBe(425);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RACE_NOT_STARTED' },
    });
  });

  it('rejects tampered access tokens and tampered manifests', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const tokenResponse = await requestRelease(
      tamperSignature(validToken()),
      environment(signedManifest(now - 1_000)),
    );
    expect(tokenResponse.status).toBe(401);

    const manifest = signedManifest(now - 1_000);
    const manifestResponse = await requestRelease(
      validToken(),
      environment({
        ...manifest,
        signature: tamperText(manifest.signature),
      }),
    );
    expect(manifestResponse.status).toBe(409);
    await expect(manifestResponse.json()).resolves.toMatchObject({
      error: { code: 'MANIFEST_INVALID' },
    });
  });

  it('returns a server error for an unexpected object-store failure', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const bindings = environment(signedManifest(now - 1_000));
    const response = await requestRelease(validToken(), {
      ...bindings,
      TIMELINE_BUCKET: {
        async get() {
          throw new Error('private storage detail');
        },
      },
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'EDGE_REQUEST_FAILED' },
    });
  });

  it('serves a release with lowercased R2 metadata keys', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await requestRelease(
      validToken(),
      environment(signedManifest(now - 1_000), {
        raceid: raceId,
        sha256: timelineSha256,
        codecversion: 'json-gzip-v1',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { scheduledStart: number } };
    expect(body.result.scheduledStart).toBe(now - 1_000);
  });

  it('serves timeline bytes after verifying their SHA-256', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await requestTimeline(validToken(), environment(signedManifest(now - 1_000)));

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).resolves.toEqual(timelineBody.buffer);
  });

  it('rejects a timeline whose body does not match the signed SHA-256', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await requestTimeline(
      validToken(),
      environment(
        signedManifest(now - 1_000),
        {
          raceid: raceId,
          sha256: timelineSha256,
        },
        new Uint8Array([9, 8, 7, 6]),
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'TIMELINE_INTEGRITY_INVALID' },
    });
  });

  it('rejects a release whose timeline metadata is invalid', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await requestRelease(
      validToken(),
      environment(signedManifest(now - 1_000), {
        raceid: 'another-race',
        sha256: 'a'.repeat(64),
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'TIMELINE_METADATA_INVALID' },
    });
  });
});

function requestRelease(token: string, bindings: Bindings): Promise<Response> {
  return handleEdgeRequest(
    new Request(`https://edge.example.test/edge/v1/races/${raceId}/release`, {
      headers: {
        origin: webOrigin,
        authorization: `Bearer ${token}`,
      },
    }),
    bindings,
  );
}

function requestTimeline(token: string, bindings: Bindings): Promise<Response> {
  return handleEdgeRequest(
    new Request(`https://edge.example.test/edge/v1/races/${raceId}/timeline`, {
      headers: {
        origin: webOrigin,
        authorization: `Bearer ${token}`,
      },
    }),
    bindings,
  );
}

function validToken(): string {
  return createEdgeAccessToken(
    {
      raceId,
      discordUserId: '987654321',
      guildId,
      nbf: Math.floor(now / 1_000) - 60,
      exp: Math.floor(now / 1_000) + 3_600,
      jti: 'edge-test-token',
    },
    tokenPrivateKey,
  );
}

function signedManifest(scheduledStart: number) {
  return signReleaseManifest(
    {
      raceId,
      raceVersion: 1,
      scheduledStart,
      timelineDuration: 60_000,
      ciphertextObjectKey: `race-timelines/${raceId}/1.bin`,
      ciphertextSha256: timelineSha256,
      codecVersion: 'json-gzip-v1',
      simulationVersion: 'sim-v1',
      iv: Buffer.alloc(12, 1).toString('base64'),
      authTag: Buffer.alloc(16, 2).toString('base64'),
    },
    manifestPrivateKey,
  );
}

function environment(
  manifest: ReturnType<typeof signedManifest>,
  timelineMetadata: Record<string, string> = { raceid: raceId, sha256: timelineSha256 },
  body: Uint8Array = timelineBody,
): Bindings {
  const bodyBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(bodyBuffer).set(body);
  return {
    TIMELINE_BUCKET: {
      async get(key) {
        if (key === `race-manifests/${raceId}.json`) {
          return {
            body: new Blob([]).stream(),
            async json() {
              return manifest;
            },
          };
        }
        if (key === manifest.manifest.ciphertextObjectKey) {
          return {
            body: new Blob([bodyBuffer]).stream(),
            customMetadata: timelineMetadata,
            async json() {
              return {};
            },
          };
        }
        return null;
      },
    },
    TIMELINE_MASTER_SECRET: Buffer.alloc(32, 3).toString('base64'),
    EDGE_TOKEN_PUBLIC_KEY: tokenPublicKey,
    MANIFEST_PUBLIC_KEY: manifestPublicKey,
    DISCORD_GUILD_ID: guildId,
    WEB_ORIGIN: webOrigin,
  };
}

function tamperSignature(token: string): string {
  const parts = token.split('.');
  const signature = parts[2];
  if (parts.length !== 3 || signature === undefined) throw new Error('Test token is malformed.');
  parts[2] = tamperText(signature);
  return parts.join('.');
}

function tamperText(value: string): string {
  return `${value.startsWith('A') ? 'B' : 'A'}${value.slice(1)}`;
}
