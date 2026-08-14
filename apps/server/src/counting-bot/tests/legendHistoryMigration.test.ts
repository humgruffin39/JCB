import { describe, expect, it } from 'vitest';
import {
  applyLegendHistory20260801,
  legendHistory20260801ImportId,
} from '../migrations/legendHistory20260801.js';
import { createInitialState } from '../persistence/stateSchema.js';
import { state } from './helpers.js';

function targetState() {
  return createInitialState({
    guildId: '1329013463175139380',
    channelId: '1533056797504569545',
    initialCount: '144',
    latestMessageId: '1533378471613694024',
    now: new Date('2026-08-02T07:38:36.000Z'),
  });
}

describe('2026-08-01 legend history import', () => {
  it('adds the 144 accepted historical counts to an existing legend', () => {
    const result = applyLegendHistory20260801({
      ...targetState(),
      successfulCounts: {
        '924311449973686282': '2',
        '30': '3',
      },
    });

    expect(result.applied).toBe(true);
    expect(result.importedCount).toBe('144');
    expect(result.state.successfulCounts).toMatchObject({
      '924311449973686282': '36',
      '963427109601181706': '20',
      '703821433934970920': '16',
      '30': '3',
    });
    expect(result.state.appliedHistoryImports).toContain(legendHistory20260801ImportId);
  });

  it('does not add the history twice', () => {
    const first = applyLegendHistory20260801(targetState());
    const second = applyLegendHistory20260801(first.state);

    expect(second.applied).toBe(false);
    expect(second.state).toBe(first.state);
    expect(second.state.successfulCounts['924311449973686282']).toBe('34');
  });

  it('does not apply the server-specific history to another channel', () => {
    const result = applyLegendHistory20260801(state());

    expect(result.applied).toBe(false);
    expect(result.state.successfulCounts).toEqual({});
    expect(result.state.appliedHistoryImports).toEqual([]);
  });
});
