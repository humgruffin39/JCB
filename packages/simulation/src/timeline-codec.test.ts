import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeTimeline, encodeTimeline } from './timeline-codec.js';
import type { TimelineFrame } from './simulation-types.js';

const frame = (timeMs: number): TimelineFrame => ({
  timeMs,
  horses: Array.from({ length: 8 }, (_, index) => ({
    horseNumber: index + 1,
    progress: 0.1,
    laneIndex: index,
    lateralOffset: 0,
    rank: index + 1,
    speed: 10,
    animationState: 'running' as const,
  })),
});

describe('timeline codec validation', () => {
  it('round-trips a valid ordered timeline', () => {
    const timeline = [frame(0), frame(100)];
    expect(decodeTimeline(encodeTimeline(timeline))).toEqual(timeline);
  });

  it('rejects non-increasing timestamps', () => {
    const encoded = gzipSync(Buffer.from(JSON.stringify([frame(100), frame(100)]), 'utf8'));
    expect(() => decodeTimeline(encoded)).toThrow(/strictly increasing/i);
  });

  it('rejects duplicate horses and ranks', () => {
    const duplicate = frame(0);
    const horses = duplicate.horses.map((horse, index) =>
      index === 7 ? { ...horse, horseNumber: 1, rank: 1 } : horse,
    );
    const encoded = gzipSync(Buffer.from(JSON.stringify([{ ...duplicate, horses }]), 'utf8'));
    expect(() => decodeTimeline(encoded)).toThrow(/each horse exactly once/i);
  });
});
