import { describe, expect, it } from 'vitest';
import { applyMessage } from '../counting/stateMachine.js';
import { message, state } from './helpers.js';

const options = {
  guildId: '10',
  channelId: '20',
  timeoutSeconds: 600,
  now: () => new Date('2026-08-01T00:00:01.000Z'),
};

describe('counting state machine', () => {
  it('accepts 1 from the initial count of 0', () => {
    const result = applyMessage(state(), message({ content: '1' }), options);
    expect(result.kind).toBe('accepted');
    expect(result.state.currentCount).toBe('1');
    expect(result.state.successfulCounts).toEqual({ '30': '1' });
  });

  it('accepts 42 when the current count is 41 without producing a failure', () => {
    const result = applyMessage(state('41'), message({ content: '42' }), options);
    expect(result.kind).toBe('accepted');
    expect(result.state.currentCount).toBe('42');
    expect(result.state.bestCount).toBe('42');
    expect(result.state.pendingFailures).toHaveLength(0);
  });

  it('accepts a correct count written with full-width digits', () => {
    const result = applyMessage(state('41'), message({ content: '４２' }), options);

    expect(result.kind).toBe('accepted');
    expect(result.state.currentCount).toBe('42');
    expect(result.state.successfulCounts).toEqual({ '30': '1' });
  });

  it('rejects a correct consecutive count from the same user without failing', () => {
    const first = applyMessage(
      state(),
      message({ id: '100', authorId: '30', content: '1' }),
      options,
    );
    const second = applyMessage(
      first.state,
      message({ id: '101', authorId: '30', content: '2' }),
      options,
    );

    expect(second.kind).toBe('consecutive_rejected');
    expect(second.state).toMatchObject({
      currentCount: '1',
      failureCounts: {},
      successfulCounts: { '30': '1' },
      lastProcessedMessageId: '101',
      lastAcceptedMessageId: '100',
      lastCounterUserId: '30',
      pendingFailures: [],
    });
  });

  it('accepts the next count from a different user', () => {
    const first = applyMessage(
      state(),
      message({ id: '100', authorId: '30', content: '1' }),
      options,
    );
    const second = applyMessage(
      first.state,
      message({ id: '101', authorId: '31', content: '2' }),
      options,
    );

    expect(second.kind).toBe('accepted');
    expect(second.state.currentCount).toBe('2');
    expect(second.state.lastCounterUserId).toBe('31');
  });

  it('still treats a wrong number from the previous counter as a failure', () => {
    const first = applyMessage(
      state(),
      message({ id: '100', authorId: '30', content: '1' }),
      options,
    );
    const second = applyMessage(
      first.state,
      message({ id: '101', authorId: '30', content: '3' }),
      options,
    );

    expect(second.kind).toBe('failed');
    expect(second.state.currentCount).toBe('0');
    expect(second.state.failureCounts).toEqual({ '30': '1' });
    expect(second.state.pendingFailures).toHaveLength(1);
  });

  it('resets to zero and records a durable failure for an unexpected number', () => {
    const result = applyMessage(state('41'), message({ content: '43' }), options);
    expect(result.kind).toBe('failed');
    expect(result.state.currentCount).toBe('0');
    expect(result.state.failureCounts).toEqual({ '30': '1' });
    expect(result.state.pendingFailures[0]).toMatchObject({
      failedMessageId: '100',
      failedUserId: '30',
      timeoutUntil: '2026-08-01T00:10:00.000Z',
      roleStatus: 'pending',
      timeoutStatus: 'pending',
      announcementStatus: 'pending',
    });
  });

  it('treats non-numeric content and extra payloads as failures', () => {
    expect(applyMessage(state('41'), message({ content: 'hello' }), options).kind).toBe('failed');
    expect(
      applyMessage(state('41'), message({ content: '42', attachmentCount: 1 }), options).kind,
    ).toBe('failed');
    expect(
      applyMessage(state('41'), message({ content: '42', stickerCount: 1 }), options).kind,
    ).toBe('failed');
    expect(applyMessage(state('41'), message({ content: '42', hasPoll: true }), options).kind).toBe(
      'failed',
    );
  });

  it('ignores bot posts while advancing the processed message watermark', () => {
    const result = applyMessage(
      state('41'),
      message({ authorIsBot: true, content: '42' }),
      options,
    );
    expect(result.kind).toBe('ignored');
    expect(result.state.currentCount).toBe('41');
    expect(result.state.lastProcessedMessageId).toBe('100');
  });

  it('ignores other channels without changing the watermark', () => {
    const original = state('41', '90');
    const result = applyMessage(original, message({ channelId: '21', content: '42' }), options);
    expect(result.kind).toBe('outside_scope');
    expect(result.state).toBe(original);
  });

  it('does not process the same message twice', () => {
    const first = applyMessage(state(), message({ id: '100' }), options);
    const second = applyMessage(first.state, message({ id: '100' }), options);
    expect(second.kind).toBe('duplicate');
    expect(second.state.currentCount).toBe('1');
  });

  it("increments each user's failures exactly once", () => {
    const firstFailure = applyMessage(
      state('41'),
      message({ id: '100', authorId: '30', content: '43' }),
      options,
    );
    const duplicate = applyMessage(
      firstFailure.state,
      message({ id: '100', authorId: '30', content: '43' }),
      options,
    );
    const secondFailure = applyMessage(
      duplicate.state,
      message({ id: '101', authorId: '31', content: '2' }),
      options,
    );
    const thirdFailure = applyMessage(
      secondFailure.state,
      message({ id: '102', authorId: '30', content: '2' }),
      options,
    );

    expect(thirdFailure.state.failureCounts).toEqual({
      '30': '2',
      '31': '1',
    });
  });

  it('preserves the best count across a reset and lower new counts', () => {
    const accepted = applyMessage(
      state('41'),
      message({ id: '100', authorId: '30', content: '42' }),
      options,
    );
    const failed = applyMessage(
      accepted.state,
      message({ id: '101', authorId: '31', content: '44' }),
      options,
    );
    const restarted = applyMessage(
      failed.state,
      message({ id: '102', authorId: '32', content: '1' }),
      options,
    );

    expect(failed.state.currentCount).toBe('0');
    expect(failed.state.bestCount).toBe('42');
    expect(restarted.state.currentCount).toBe('1');
    expect(restarted.state.bestCount).toBe('42');
  });

  it('counts each accepted message once per user for the legend', () => {
    const first = applyMessage(
      state(),
      message({ id: '100', authorId: '30', content: '1' }),
      options,
    );
    const duplicate = applyMessage(
      first.state,
      message({ id: '100', authorId: '30', content: '1' }),
      options,
    );
    const second = applyMessage(
      duplicate.state,
      message({ id: '101', authorId: '31', content: '2' }),
      options,
    );
    const third = applyMessage(
      second.state,
      message({ id: '102', authorId: '30', content: '3' }),
      options,
    );

    expect(third.state.successfulCounts).toEqual({
      '30': '2',
      '31': '1',
    });
  });

  it('uses BigInt for counts above the safe integer range', () => {
    const result = applyMessage(
      state('9007199254740992'),
      message({ content: '9007199254740993' }),
      options,
    );
    expect(result.kind).toBe('accepted');
    expect(result.state.currentCount).toBe('9007199254740993');
  });
});
