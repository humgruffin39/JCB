import { canonicalJson, edgeAccessClaimsSchema, signedManifestSchema } from '@jcb/contracts';
import type { z } from 'zod';

export async function verifyAccessToken(
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

export async function verifyManifest(
  signedInput: z.infer<typeof signedManifestSchema>,
  publicKeyValue: string,
): Promise<z.infer<typeof signedManifestSchema>['manifest']> {
  const signed = signedManifestSchema.parse(signedInput);
  const key = await importEd25519PublicKey(publicKeyValue);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    key,
    webBuffer(base64UrlToBytes(signed.signature)),
    new TextEncoder().encode(canonicalJson(signed.manifest)),
  );
  if (!valid) throw new Error('MANIFEST_SIGNATURE_INVALID');
  return signed.manifest;
}

export async function deriveTimelineKey(
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

export async function deriveVerifiedTimelineKey(
  masterSecrets: readonly string[],
  raceId: string,
  simulationVersion: string,
  raceVersion: number,
  iv: string,
  authTag: string,
  ciphertext: ArrayBuffer,
): Promise<Uint8Array> {
  const ciphertextWithTag = new Uint8Array(
    ciphertext.byteLength + base64ToBytes(authTag).byteLength,
  );
  ciphertextWithTag.set(new Uint8Array(ciphertext));
  ciphertextWithTag.set(base64ToBytes(authTag), ciphertext.byteLength);
  for (const masterSecret of masterSecrets) {
    const keyBytes = await deriveTimelineKey(masterSecret, raceId, simulationVersion, raceVersion);
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        webBuffer(keyBytes),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: webBuffer(base64ToBytes(iv)), tagLength: 128 },
        key,
        webBuffer(ciphertextWithTag),
      );
      return keyBytes;
    } catch {
      continue;
    }
  }
  throw new Error('TIMELINE_KEY_INVALID');
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function webBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
