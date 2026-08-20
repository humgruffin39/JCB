import {
  apiErrorSchema,
  edgeReleaseResponseSchema,
  timelineSchema,
  type TimelineFrameContract,
} from '@jcb/contracts';
import { EDGE_ORIGIN } from './api.js';

export type TimelineFrame = TimelineFrameContract;

export interface LoadedTimeline {
  readonly frames: readonly TimelineFrame[];
  readonly duration: number;
}

export class TimelineRequestError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  public constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'TimelineRequestError';
    this.status = status;
    this.code = code;
  }
}

export const MAX_TIMELINE_DECOMPRESSED_BYTES = 64 * 1_024 * 1_024;

export async function loadTimeline(
  raceId: string,
  raceVersion: number,
  token: string,
  signal?: AbortSignal,
): Promise<LoadedTimeline> {
  const headers = { authorization: `Bearer ${token}` };
  const releaseResponse = await fetch(
    `${EDGE_ORIGIN}/edge/v1/races/${encodeURIComponent(raceId)}/release`,
    { headers, cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
  );
  if (!releaseResponse.ok) {
    const code = await readApiErrorCode(releaseResponse);
    throw new TimelineRequestError(
      code === 'RACE_NOT_STARTED' ? '発走時刻前です' : 'レース映像の解放情報を取得できません',
      releaseResponse.status,
      code,
    );
  }
  const release = edgeReleaseResponseSchema.parse(await releaseResponse.json()).result;
  if (release.raceId !== raceId || release.raceVersion !== raceVersion) {
    throw new Error('レース情報の版が一致しません');
  }
  const timelineResponse = await fetch(`${EDGE_ORIGIN}${release.timelinePath}`, {
    headers,
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!timelineResponse.ok) {
    throw new TimelineRequestError(
      '暗号化されたレース映像を取得できません',
      timelineResponse.status,
      await readApiErrorCode(timelineResponse),
    );
  }
  const ciphertext = new Uint8Array(await timelineResponse.arrayBuffer());
  const authTag = base64Bytes(release.authTag);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const key = await crypto.subtle.importKey(
    'raw',
    webBuffer(base64Bytes(release.timelineKey)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: webBuffer(base64Bytes(release.iv)), tagLength: 128 },
    key,
    combined.buffer,
  );
  const decompressed = new Blob([plaintext]).stream().pipeThrough(new DecompressionStream('gzip'));
  return {
    frames: timelineSchema.parse(await readLimitedJsonStream(decompressed)),
    duration: release.timelineDuration,
  };
}

async function readApiErrorCode(response: Response): Promise<string | undefined> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a UTF-8 JSON stream without allowing a corrupt compressed payload to
 * expand until the browser runs out of memory. The limit is measured in bytes
 * before UTF-8 decoding, so multi-byte text cannot bypass it.
 */
export async function readLimitedJsonStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes = MAX_TIMELINE_DECOMPRESSED_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const decodedChunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Timeline exceeds decompressed size limit').catch(() => undefined);
        throw new Error('レース映像データのサイズが上限を超えています');
      }
      decodedChunks.push(decoder.decode(value, { stream: true }));
    }
    decodedChunks.push(decoder.decode());
    return JSON.parse(decodedChunks.join('')) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function webBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
