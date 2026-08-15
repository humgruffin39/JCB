import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  createEdgeAccessToken,
  decryptAesGcm,
  decryptAesGcmWithKeys,
  deriveResultKey,
  deriveTimelineKey,
  encryptAesGcm,
  hashOpaqueToken,
  matchesOpaqueTokenHash,
  signReleaseManifest,
  verifyEdgeAccessToken,
  verifyReleaseManifest,
} from './result-secrecy.js';

const masterSecret = randomBytes(32).toString('base64');

describe('result secrecy', () => {
  it('keeps timeline and result keys separate and rejects the wrong key', () => {
    const timelineKey = deriveTimelineKey(masterSecret, 'race-1', 'sim-v1', 1);
    const resultKey = deriveResultKey(masterSecret, 'race-1', 'sim-v1', 1);
    expect(timelineKey.equals(resultKey)).toBe(false);
    const encrypted = encryptAesGcm(Buffer.from('secret result'), resultKey);
    expect(() => decryptAesGcm(encrypted, timelineKey)).toThrow();
    expect(Buffer.from(decryptAesGcm(encrypted, resultKey)).toString('utf8')).toBe('secret result');
  });

  it('rejects ciphertext tampering', () => {
    const key = deriveTimelineKey(masterSecret, 'race-1', 'sim-v1', 1);
    const encrypted = encryptAesGcm(Buffer.from('timeline'), key);
    const bytes = Buffer.from(encrypted.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 1;
    expect(() =>
      decryptAesGcm({ ...encrypted, ciphertext: bytes.toString('base64') }, key),
    ).toThrow();
  });

  it('supports decrypting with a current key followed by a previous key', () => {
    const previousSecret = randomBytes(32).toString('base64');
    const currentSecret = randomBytes(32).toString('base64');
    const previousKey = deriveResultKey(previousSecret, 'race-1', 'sim-v1', 1);
    const currentKey = deriveResultKey(currentSecret, 'race-1', 'sim-v1', 1);
    const encrypted = encryptAesGcm(Buffer.from('rotated result'), previousKey);

    expect(
      Buffer.from(decryptAesGcmWithKeys(encrypted, [currentKey, previousKey])).toString('utf8'),
    ).toBe('rotated result');
    expect(() => decryptAesGcmWithKeys(encrypted, [currentKey])).toThrow();
  });

  it('signs manifests and race-bound access tokens with Ed25519', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signReleaseManifest(
      {
        raceId: 'race-1',
        raceVersion: 1,
        scheduledStart: 1_000_000,
        timelineDuration: 60_000,
        ciphertextObjectKey: 'timelines/race-1/unguessable-object',
        ciphertextSha256: 'a'.repeat(64),
        codecVersion: 'codec-v1',
        simulationVersion: 'sim-v1',
        iv: 'base64-initialization-vector',
        authTag: 'base64-authentication-tag',
      },
      privateKey,
    );
    expect(verifyReleaseManifest(signed, publicKey).raceId).toBe('race-1');

    const token = createEdgeAccessToken(
      {
        raceId: 'race-1',
        discordUserId: '123',
        guildId: '456',
        nbf: 900,
        exp: 1_100,
        jti: 'token-1',
      },
      privateKey,
    );
    expect(verifyEdgeAccessToken(token, publicKey, 1_000).raceId).toBe('race-1');
    expect(() => verifyEdgeAccessToken(token, publicKey, 1_100)).toThrow();
  });

  it('compares opaque token digests without accepting malformed or different values', () => {
    const token = 'opaque-session-token';
    expect(matchesOpaqueTokenHash(token, hashOpaqueToken(token))).toBe(true);
    expect(matchesOpaqueTokenHash('different-token', hashOpaqueToken(token))).toBe(false);
    expect(matchesOpaqueTokenHash(token, 'not-a-sha256-digest')).toBe(false);
  });
});
