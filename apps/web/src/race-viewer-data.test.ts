import { describe, expect, it } from 'vitest';
import {
  hasUnsettledBet,
  raceResultRetryDelay,
  shouldFetchRaceResult,
} from './race-viewer-data.js';

describe('shouldFetchRaceResult', () => {
  it('prefetches official results for every terminal race status', () => {
    expect(shouldFetchRaceResult('finished', false)).toBe(true);
    expect(shouldFetchRaceResult('settling', false)).toBe(true);
    expect(shouldFetchRaceResult('settled', false)).toBe(true);
  });

  it('loads a live race result only after presentation requests it', () => {
    expect(shouldFetchRaceResult('running', false)).toBe(false);
    expect(shouldFetchRaceResult('running', true)).toBe(true);
  });
});

describe('raceResultRetryDelay', () => {
  it('backs off transient result failures without growing beyond fifteen seconds', () => {
    expect([0, 1, 2, 3, 4, 5].map(raceResultRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });
});

describe('hasUnsettledBet', () => {
  it('is true while any ticket is still open', () => {
    expect(
      hasUnsettledBet([
        {
          id: 'a',
          poolType: 'win',
          selectionCode: '1',
          stake: '100',
          status: 'won',
          payout: '300',
          createdAt: 1,
        },
        {
          id: 'b',
          poolType: 'win',
          selectionCode: '2',
          stake: '100',
          status: 'open',
          payout: '0',
          createdAt: 2,
        },
      ]),
    ).toBe(true);
  });

  it('is false once settlement has moved every ticket', () => {
    expect(
      hasUnsettledBet([
        {
          id: 'a',
          poolType: 'win',
          selectionCode: '1',
          stake: '100',
          status: 'won',
          payout: '300',
          createdAt: 1,
        },
        {
          id: 'b',
          poolType: 'win',
          selectionCode: '2',
          stake: '100',
          status: 'lost',
          payout: '0',
          createdAt: 2,
        },
      ]),
    ).toBe(false);
  });

  it('is false when nothing was bought', () => {
    expect(hasUnsettledBet([])).toBe(false);
  });
});
