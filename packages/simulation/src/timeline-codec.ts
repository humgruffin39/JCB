import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { TimelineFrame } from './simulation-types.js';

export const TIMELINE_CODEC_VERSION = 'json-gzip-v1';
const MAXIMUM_TIMELINE_BYTES = 64 * 1024 * 1024;

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
  const parsed: unknown = JSON.parse(
    gunzipSync(payload, { maxOutputLength: MAXIMUM_TIMELINE_BYTES }).toString('utf8'),
  );
  const frames = z.array(timelineFrameSchema).parse(parsed);
  validateTimelineSequence(frames);
  return frames;
}

function validateTimelineSequence(frames: readonly TimelineFrame[]): void {
  let previousTime = -1;
  for (const frame of frames) {
    if (frame.timeMs <= previousTime)
      throw new Error('Timeline times must be strictly increasing.');
    previousTime = frame.timeMs;
    if (new Set(frame.horses.map((horse) => horse.horseNumber)).size !== 8) {
      throw new Error('Timeline frames must contain each horse exactly once.');
    }
    if (new Set(frame.horses.map((horse) => horse.rank)).size !== 8) {
      throw new Error('Timeline frames must contain each rank exactly once.');
    }
  }
}
