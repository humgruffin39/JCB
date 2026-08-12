import { describe, expect, it } from 'vitest';
import { raceIdFromPathname } from './app.js';

describe('raceIdFromPathname', () => {
  it('does not restore a previous race from the generic ticket path', () => {
    expect(raceIdFromPathname('/ticket')).toBeUndefined();
  });

  it('reads a race id only from a race route', () => {
    expect(raceIdFromPathname('/races/race-1')).toBe('race-1');
  });
});
