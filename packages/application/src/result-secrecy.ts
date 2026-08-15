import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyLike,
} from 'node:crypto';
import {
  edgeAccessClaimsSchema,
  releaseManifestSchema,
  signedManifestSchema,
} from '@jcb/contracts';
import type { z } from 'zod';

export interface EncryptedPayload {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
}

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type SignedManifest = z.infer<typeof signedManifestSchema>;

export function deriveTimelineKey(
  masterSecret: string,
  raceId: string,
  simulationVersion: string,
  raceVersion: number,
): Buffer {
  return deriveKey(masterSecret, raceId, `timeline:${simulationVersion}:${String(raceVersion)}`);
}

export function deriveResultKey(
  masterSecret: string,
  raceId: string,
  simulationVersion: string,
  raceVersion: number,
): Buffer {
  return deriveKey(masterSecret, raceId, `result:${simulationVersion}:${String(raceVersion)}`);
}

export function encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): EncryptedPayload {
  if (key.byteLength !== 32) throw new Error('AES-256-GCM requires a 32-byte key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAesGcm(payload: EncryptedPayload, key: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw new Error('AES-256-GCM requires a 32-byte key.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

export function decryptAesGcmWithKeys(
  payload: EncryptedPayload,
  keys: readonly Uint8Array[],
): Uint8Array {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptAesGcm(payload, key);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('AES-256-GCM payload could not be decrypted with the configured keys.');
}

export function signReleaseManifest(
  manifestInput: ReleaseManifest,
  privateKey: KeyLike | string,
): SignedManifest {
  const manifest = releaseManifestSchema.parse(manifestInput);
  const bytes = Buffer.from(stableStringify(manifest), 'utf8');
  return {
    manifest,
    signature: sign(null, bytes, privateKey).toString('base64url'),
  };
}

export function verifyReleaseManifest(
  input: SignedManifest,
  publicKey: KeyLike | string,
): ReleaseManifest {
  const signed = signedManifestSchema.parse(input);
  const isValid = verify(
    null,
    Buffer.from(stableStringify(signed.manifest), 'utf8'),
    publicKey,
    Buffer.from(signed.signature, 'base64url'),
  );
  if (!isValid) throw new Error('Release manifest signature is invalid.');
  return signed.manifest;
}

export function createEdgeAccessToken(
  claimsInput: z.infer<typeof edgeAccessClaimsSchema>,
  privateKey: KeyLike | string,
): string {
  const claims = edgeAccessClaimsSchema.parse(claimsInput);
  const header = base64UrlJson({ alg: 'EdDSA', typ: 'JWT' });
  const payload = base64UrlJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput, 'ascii'), privateKey).toString(
    'base64url',
  );
  return `${signingInput}.${signature}`;
}

export function verifyEdgeAccessToken(
  token: string,
  publicKey: KeyLike | string,
  nowEpochSeconds: number,
): z.infer<typeof edgeAccessClaimsSchema> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Edge access token is malformed.');
  const [header, payload, signature] = parts as [string, string, string];
  const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as unknown;
  if (
    typeof parsedHeader !== 'object' ||
    parsedHeader === null ||
    !('alg' in parsedHeader) ||
    parsedHeader.alg !== 'EdDSA'
  ) {
    throw new Error('Edge access token algorithm is invalid.');
  }
  const signingInput = `${header}.${payload}`;
  if (
    !verify(
      null,
      Buffer.from(signingInput, 'ascii'),
      publicKey,
      Buffer.from(signature, 'base64url'),
    )
  ) {
    throw new Error('Edge access token signature is invalid.');
  }
  const claims = edgeAccessClaimsSchema.parse(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  );
  if (nowEpochSeconds < claims.nbf || nowEpochSeconds >= claims.exp) {
    throw new Error('Edge access token is not currently valid.');
  }
  return claims;
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Compares an opaque token with a stored SHA-256 digest without data-dependent string comparison. */
export function matchesOpaqueTokenHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOpaqueToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

export function sha256(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function deriveKey(masterSecret: string, salt: string, info: string): Buffer {
  const inputKeyMaterial = Buffer.from(masterSecret, 'base64');
  if (inputKeyMaterial.byteLength < 32) {
    throw new Error('Master secret must be at least 32 bytes encoded as base64.');
  }
  return Buffer.from(hkdfSync('sha256', inputKeyMaterial, salt, info, 32));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
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
