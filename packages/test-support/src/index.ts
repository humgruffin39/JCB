import { identifier, timestamp, type Clock, type HorseSnapshot, type Timestamp } from '@jcb/domain';

export class FixedClock implements Clock {
  public constructor(private current: Timestamp) {}

  public now(): Timestamp {
    return this.current;
  }

  public set(value: Timestamp): void {
    this.current = value;
  }
}

export function fixedClock(value = Date.parse('2026-08-03T12:00:00Z')): FixedClock {
  return new FixedClock(timestamp(value));
}

export function horseFixture(
  number: number,
  overrides: Partial<HorseSnapshot> = {},
): HorseSnapshot {
  return {
    horseId: identifier(`01K-HORSE-${String(number).padStart(2, '0')}`),
    name: `テストホース${number}`,
    runningStyle: number % 2 === 0 ? 'closer' : 'front_runner',
    speed: 45 + number,
    start: 45 + number,
    acceleration: 45 + number,
    stamina: 45 + number,
    lateKick: 45 + number,
    conditionStability: 50,
    distancePreference: 0,
    surfacePreference: 0,
    ...overrides,
  };
}
