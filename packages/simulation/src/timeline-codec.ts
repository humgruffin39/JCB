import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { TimelineFrame } from './simulator.js';

export const TIMELINE_CODEC_VERSION = 'json-gzip-v1';

const timelineFrameSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  horses: z
    .array(
      z.object({
        horseNumber: z.number().int().min(1).max(8),
        progress: z.number().min(0).max(1),
        laneIndex: z.number().int().min(0).max(7),
        lateralOffset: z.number(),
        rank: z.number().int().min(1).max(8),
        speed: z.number().nonnegative(),
        animationState: z.enum(['waiting', 'running', 'finished']),
      }),
    )
    .length(8),
});

export function encodeTimeline(frames: readonly TimelineFrame[]): Uint8Array {
  const payload = Buffer.from(JSON.stringify(frames), 'utf8');
  return gzipSync(payload, { level: 6 });
}

export function decodeTimeline(payload: Uint8Array): readonly TimelineFrame[] {
  const parsed: unknown = JSON.parse(gunzipSync(payload).toString('utf8'));
  return z.array(timelineFrameSchema).parse(parsed);
}
