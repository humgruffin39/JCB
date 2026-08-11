import { describe, expect, it } from 'vitest';
import { finishLineOffset, racingLineOffset, type RacingLineHorse } from './race-lines.js';

const field: readonly RacingLineHorse[] = Array.from({ length: 8 }, (_, index) => ({
  horseNumber: index + 1,
  progress: 0.4 - index * 0.008,
  rank: index + 1,
  speed: 17 + (7 - index) * 0.08,
  laneIndex: index,
  lateralOffset: 0,
}));

describe('visual racing lines', () => {
  it('spreads the photo finish slots by official position', () => {
    const offsets = Array.from({ length: 8 }, (_, index) => finishLineOffset(index + 1, 8));

    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    expect(offsets[0]).toBeCloseTo(-3.325, 3);
    expect(offsets.at(-1)).toBeCloseTo(3.325, 3);
    expect(new Set(offsets).size).toBe(8);
  });

  it('holds the starting stalls before allowing the field to merge', () => {
    const horse = { ...field[7]!, progress: 0 };
    expect(racingLineOffset(horse, [horse])).toBeCloseTo(4.27, 5);
  });

  it('does not keep the starting-lane spacing after the merge', () => {
    const offsets = field.map((horse) => racingLineOffset(horse, field));
    const startingSpan = 7 * 1.22;
    const racingSpan = Math.max(...offsets) - Math.min(...offsets);

    expect(racingSpan).toBeLessThan(startingSpan * 0.65);
    expect(new Set(offsets.map((offset) => offset.toFixed(2))).size).toBeGreaterThan(4);
  });

  it('moves a fast blocked horse outward to find a passing line', () => {
    const chaser = { ...field[3]!, progress: 0.5, speed: 20 };
    const clearLine = racingLineOffset(chaser, [chaser]);
    const blocker = { ...field[1]!, progress: 0.507, speed: 16 };
    const passingLine = racingLineOffset(chaser, [chaser, blocker]);

    expect(passingLine).toBeLessThan(clearLine - 0.7);
  });
});
