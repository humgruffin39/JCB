import { describe, expect, it, vi } from 'vitest';
import {
  ConsecutiveWarningNotifier,
  type ConsecutiveWarningAdapter,
} from '../discord/consecutiveWarning.js';
import { Logger } from '../logging/logger.js';

describe('consecutive count warning', () => {
  it('keeps the warning and deletes the rejected count message', async () => {
    const sendReply = vi.fn<ConsecutiveWarningAdapter['sendReply']>(() =>
      Promise.resolve({
        id: '999',
      }),
    );
    const deleteSourceMessage = vi.fn<ConsecutiveWarningAdapter['deleteSourceMessage']>(() =>
      Promise.resolve(),
    );
    const notifier = new ConsecutiveWarningNotifier(
      { sendReply, deleteSourceMessage },
      '<:warning:1432393358214692926>',
      new Logger('error'),
    );

    await notifier.notify({ messageId: '101', userId: '30' });

    expect(sendReply).toHaveBeenCalledWith({
      sourceMessageId: '101',
      userId: '30',
      content:
        '<:warning:1432393358214692926> <:warning:1432393358214692926> <:warning:1432393358214692926> 同じ人が連続でカウントすることはできないよ！',
      allowedMentions: {
        users: ['30'],
        roles: [],
        repliedUser: true,
      },
    });
    expect(deleteSourceMessage).toHaveBeenCalledOnce();
    expect(deleteSourceMessage).toHaveBeenCalledWith('101');
    expect(sendReply.mock.invocationCallOrder[0]).toBeLessThan(
      deleteSourceMessage.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('still deletes the rejected count when the warning cannot be sent', async () => {
    const sendError = Object.assign(new Error('Missing Permissions'), {
      code: 50_013,
      status: 403,
    });
    const sendReply = vi.fn<ConsecutiveWarningAdapter['sendReply']>(() =>
      Promise.reject(sendError),
    );
    const deleteSourceMessage = vi.fn<ConsecutiveWarningAdapter['deleteSourceMessage']>(() =>
      Promise.resolve(),
    );
    const notifier = new ConsecutiveWarningNotifier(
      { sendReply, deleteSourceMessage },
      '<:warning:1432393358214692926>',
      new Logger('error'),
    );

    await notifier.notify({ messageId: '101', userId: '30' });

    expect(deleteSourceMessage).toHaveBeenCalledWith('101');
  });
});
