import { describe, expect, it } from 'vitest';
import type { SqliteViewerStore } from '@jcb/database';
import { resolveFinishOrder } from './discord-race-message-options.js';

function fakeViewerStore(
  result: () => { finishOrder: readonly { horseNumber: number; position: number }[] },
): SqliteViewerStore {
  return {
    getResult: () => result(),
  } as unknown as SqliteViewerStore;
}

describe('resolveFinishOrder', () => {
  it('returns finish order only while settling or settled', () => {
    const order = {
      finishOrder: [
        { horseNumber: 4, position: 1 },
        { horseNumber: 1, position: 2 },
      ],
    };
    expect(
      resolveFinishOrder(
        fakeViewerStore(() => order),
        'race-1',
        'settling',
      ),
    ).toBe(order.finishOrder);
    expect(
      resolveFinishOrder(
        fakeViewerStore(() => order),
        'race-1',
        'settled',
      ),
    ).toBe(order.finishOrder);
  });

  it('skips the database lookup before settlement so live cards stay ordered by horse number', () => {
    expect(
      resolveFinishOrder(
        fakeViewerStore(() => {
          throw new Error('RACE_NOT_FINISHED');
        }),
        'race-1',
        'betting_open',
      ),
    ).toBeUndefined();
    expect(
      resolveFinishOrder(
        fakeViewerStore(() => {
          throw new Error('RACE_NOT_FINISHED');
        }),
        'race-1',
        'finished',
      ),
    ).toBeUndefined();
  });

  it('falls back to undefined when the race result is unavailable after settlement', () => {
    expect(
      resolveFinishOrder(
        fakeViewerStore(() => {
          throw new Error('RACE_NOT_FINISHED');
        }),
        'race-1',
        'settled',
      ),
    ).toBeUndefined();
  });
});
