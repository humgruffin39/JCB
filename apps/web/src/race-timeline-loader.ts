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

export async function loadTimeline(
  raceId: string,
  raceVersion: number,
  token: string,
): Promise<LoadedTimeline> {
  const headers = { authorization: `Bearer ${token}` };
  const releaseResponse = await fetch(
    `${EDGE_ORIGIN}/edge/v1/races/${encodeURIComponent(raceId)}/release`,
    { headers },
  );
  if (!releaseResponse.ok) {
    const parsedError = apiErrorSchema.safeParse(await releaseResponse.json());
    throw new Error(
      parsedError.success && parsedError.data.error.code === 'RACE_NOT_STARTED'
        ? '発走時刻前です'
        : 'レース映像の解放情報を取得できません',
    );
  }
  const release = edgeReleaseResponseSchema.parse(await releaseResponse.json()).result;
  if (release.raceId !== raceId || release.raceVersion !== raceVersion) {
    throw new Error('レース情報の版が一致しません');
  }
  const timelineResponse = await fetch(`${EDGE_ORIGIN}${release.timelinePath}`, { headers });
  if (!timelineResponse.ok) throw new Error('暗号化されたレース映像を取得できません');
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
  const decompressed = new Response(
    new Blob([plaintext]).stream().pipeThrough(new DecompressionStream('gzip')),
  );
  return {
    frames: timelineSchema.parse((await decompressed.json()) as unknown),
    duration: release.timelineDuration,
  };
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
