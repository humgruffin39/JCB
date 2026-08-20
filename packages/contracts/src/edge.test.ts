import { timelineSchema } from './edge.js';

function frame(timeMs: number) {
  return {
    timeMs,
    horses: Array.from({ length: 8 }, (_, index) => ({
      horseNumber: index + 1,
      progress: 0,
      laneIndex: index,
      lateralOffset: 0,
      rank: index + 1,
      speed: 0,
      animationState: 'waiting' as const,
    })),
  };
}

describe('timelineSchema', () => {
  it('accepts complete frames in chronological order', () => {
    expect(timelineSchema.safeParse([frame(0), frame(100)]).success).toBe(true);
  });

  it('rejects duplicate horses and ranks', () => {
    const value = frame(0);
    value.horses[7] = { ...value.horses[7]!, horseNumber: 1, rank: 1 };
    expect(timelineSchema.safeParse([value]).success).toBe(false);
  });

  it('rejects timestamps that do not increase', () => {
    expect(timelineSchema.safeParse([frame(100), frame(100)]).success).toBe(false);
    expect(timelineSchema.safeParse([frame(100), frame(99)]).success).toBe(false);
  });
});
