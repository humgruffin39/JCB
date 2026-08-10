import { DomainError } from './errors.js';
import { canTransitionRace, transitionRace, type RaceStatus } from './race-state.js';

describe('race state machine', () => {
  it('accepts each specified happy-path transition', () => {
    const path: readonly RaceStatus[] = [
      'draft',
      'locked',
      'simulating',
      'betting_open',
      'betting_closed',
      'ready',
      'running',
      'finished',
      'settling',
      'settled',
    ];
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionRace(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it('rejects an unspecified transition', () => {
    expect(() => transitionRace('betting_open', 'draft')).toThrowError(DomainError);
  });
});
