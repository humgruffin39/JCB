import { describe, expect, it } from 'vitest';
import { ProcessingQueue } from '../counting/processingQueue.js';
import { applyMessage } from '../counting/stateMachine.js';
import type { BotState } from '../persistence/stateSchema.js';
import { message, state } from './helpers.js';

describe('ProcessingQueue', () => {
  it('orders a simultaneous batch by Discord snowflake', async () => {
    const processed: string[] = [];
    const queue = new ProcessingQueue<{ readonly id: string }>((item) => {
      processed.push(item.id);
      return Promise.resolve();
    });

    await Promise.all([queue.enqueue({ id: '430' }), queue.enqueue({ id: '420' })]);

    expect(processed).toEqual(['420', '430']);
  });

  it('accepts simultaneous 42 and 43 in ID order when the count is 41', async () => {
    let currentState: BotState = state('41', '400');
    const outcomes: string[] = [];
    const queue = new ProcessingQueue((item: ReturnType<typeof message>) => {
      const result = applyMessage(currentState, item, {
        guildId: '10',
        channelId: '20',
        timeoutSeconds: 600,
      });
      currentState = result.state;
      outcomes.push(`${item.content}:${result.kind}`);
      return Promise.resolve();
    });

    await Promise.all([
      queue.enqueue(message({ id: '430', authorId: '31', content: '43' })),
      queue.enqueue(message({ id: '420', authorId: '30', content: '42' })),
    ]);

    expect(outcomes).toEqual(['42:accepted', '43:accepted']);
    expect(currentState.currentCount).toBe('43');
  });

  it('never runs two handlers concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const queue = new ProcessingQueue<{ readonly id: string }>(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      active -= 1;
    });

    await Promise.all([
      queue.enqueue({ id: '100' }),
      queue.enqueue({ id: '101' }),
      queue.enqueue({ id: '102' }),
    ]);
    expect(maximumActive).toBe(1);
  });
});
