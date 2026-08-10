import { createEdgeAccessToken, signReleaseManifest } from '@jcb/application';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleEdgeRequest, type Bindings } from './index.js';

const now = 1_800_000_000_000;
const guildId = '123456789';
const raceId = 'race-edge-test';
const webOrigin = 'https://racing.example.test';
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
    expect(manifestResponse.status).toBe(401);
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
      ciphertextSha256: 'a'.repeat(64),
      codecVersion: 'json-gzip-v1',
      simulationVersion: 'sim-v1',
      iv: Buffer.alloc(12, 1).toString('base64'),
      authTag: Buffer.alloc(16, 2).toString('base64'),
    },
    manifestPrivateKey,
  );
}

function environment(manifest: ReturnType<typeof signedManifest>): Bindings {
  return {
    TIMELINE_BUCKET: {
      async get(key) {
        if (key !== `race-manifests/${raceId}.json`) return null;
        return {
          body: new Blob([]).stream(),
          async json() {
            return manifest;
          },
        };
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
