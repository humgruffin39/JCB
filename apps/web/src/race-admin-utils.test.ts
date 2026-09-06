import { selectBalancedField } from './race-admin-utils.js';
import type { HorseOption } from './race-admin-model.js';

const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

function roster(frontRunners: number, closers: number): readonly HorseOption[] {
  return [
    ...Array.from({ length: frontRunners }, (_, index) => ({
      id: `f${String(index)}`,
      name: `逃げ${String(index)}`,
      status: 'active',
      runningStyle: 'front_runner' as const,
    })),
    ...Array.from({ length: closers }, (_, index) => ({
      id: `c${String(index)}`,
      name: `差し${String(index)}`,
      status: 'active',
      runningStyle: 'closer' as const,
    })),
  ];
}

function counts(field: readonly HorseOption[]): { front: number; closer: number } {
  return {
    front: field.filter((horse) => horse.runningStyle === 'front_runner').length,
    closer: field.filter((horse) => horse.runningStyle === 'closer').length,
  };
}

describe('selectBalancedField', () => {
  it('splits the field evenly when both styles are plentiful', () => {
    const field = selectBalancedField(roster(10, 11), 8, identityShuffle);
    expect(field).toHaveLength(8);
    expect(counts(field)).toEqual({ front: 4, closer: 4 });
  });

  it('fills from the other style when one cannot cover its half', () => {
    const field = selectBalancedField(roster(2, 20), 8, identityShuffle);
    expect(counts(field)).toEqual({ front: 2, closer: 6 });
  });

  it('takes every horse of a scarce style before topping up', () => {
    const field = selectBalancedField(roster(20, 1), 8, identityShuffle);
    expect(counts(field)).toEqual({ front: 7, closer: 1 });
  });

  it('never repeats a horse', () => {
    const field = selectBalancedField(roster(9, 9), 8, identityShuffle);
    expect(new Set(field.map((horse) => horse.id)).size).toBe(8);
  });

  it('returns everything it can when the roster is too small', () => {
    expect(selectBalancedField(roster(2, 3), 8, identityShuffle)).toHaveLength(5);
  });

  it('still fills the field when a running style is not recognised', () => {
    const odd = [
      ...roster(3, 0),
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `x${String(index)}`,
        name: `不明${String(index)}`,
        status: 'active',
        runningStyle: 'unknown' as unknown as HorseOption['runningStyle'],
      })),
    ];
    expect(selectBalancedField(odd, 8, identityShuffle)).toHaveLength(8);
  });
});
