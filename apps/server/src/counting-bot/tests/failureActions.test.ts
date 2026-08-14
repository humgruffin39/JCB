import { describe, expect, it, vi } from 'vitest';
import {
  FailureExecutor,
  type FailureActionAdapter,
  type FailureAnnouncement,
} from '../discord/failureActions.js';
import { Logger } from '../logging/logger.js';
import type { BotState } from '../persistence/stateSchema.js';
import { pendingFailure, state } from './helpers.js';

class MockAdapter implements FailureActionAdapter {
  public readonly addRole = vi.fn<FailureActionAdapter['addRole']>(() => Promise.resolve());
  public readonly applyTimeout = vi.fn<FailureActionAdapter['applyTimeout']>(() =>
    Promise.resolve(),
  );
  public readonly findExistingAnnouncement = vi.fn<
    FailureActionAdapter['findExistingAnnouncement']
  >(() => Promise.resolve(null));
  public readonly sendAnnouncement = vi.fn<FailureActionAdapter['sendAnnouncement']>(
    (announcement: FailureAnnouncement) => {
      void announcement;
      return Promise.resolve('999');
    },
  );
}

function stateWithFailure(): BotState {
  return {
    ...state('0', '100'),
    pendingFailures: [pendingFailure()],
  };
}

function executor(adapter: FailureActionAdapter): FailureExecutor {
  return new FailureExecutor(
    adapter,
    { penaltyRoleId: '40' },
    '<:failure:50>',
    new Logger('error'),
    {
      retry: {
        delaysMs: [0, 0, 0],
        sleep: () => Promise.resolve(),
      },
      now: () => new Date('2026-08-01T00:01:00.000Z'),
    },
  );
}

async function execute(
  adapter: FailureActionAdapter,
): Promise<{ readonly state: BotState; readonly writes: readonly BotState[] }> {
  const writes: BotState[] = [];
  const result = await executor(adapter).resumeAll(stateWithFailure(), (updated) => {
    writes.push(updated);
    return Promise.resolve();
  });
  return { state: result, writes };
}

function permanentPermissionError(): Error & { status: number; code: number } {
  return Object.assign(new Error('Missing Permissions'), {
    status: 403,
    code: 50_013,
  });
}

describe('FailureExecutor', () => {
  it('tries timeout and announcement even when role assignment fails', async () => {
    const adapter = new MockAdapter();
    adapter.addRole.mockRejectedValue(permanentPermissionError());

    const result = await execute(adapter);

    expect(adapter.applyTimeout).toHaveBeenCalledOnce();
    expect(adapter.sendAnnouncement).toHaveBeenCalledOnce();
    expect(result.state.pendingFailures).toHaveLength(0);
  });

  it('tries the announcement even when timeout fails', async () => {
    const adapter = new MockAdapter();
    adapter.applyTimeout.mockRejectedValue(permanentPermissionError());

    await execute(adapter);

    expect(adapter.addRole).toHaveBeenCalledOnce();
    expect(adapter.sendAnnouncement).toHaveBeenCalledOnce();
  });

  it('retries with the original absolute timeout and never extends it', async () => {
    const adapter = new MockAdapter();
    adapter.applyTimeout
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce();

    await execute(adapter);

    expect(adapter.applyTimeout).toHaveBeenCalledTimes(2);
    const first = adapter.applyTimeout.mock.calls[0]?.[1];
    const second = adapter.applyTimeout.mock.calls[1]?.[1];
    expect(first?.toISOString()).toBe('2026-08-01T00:10:00.000Z');
    expect(second?.toISOString()).toBe(first?.toISOString());
  });

  it('detects a previously sent reply and avoids duplicate announcements', async () => {
    const adapter = new MockAdapter();
    adapter.findExistingAnnouncement.mockResolvedValue('999');

    const result = await execute(adapter);

    expect(adapter.sendAnnouncement).not.toHaveBeenCalled();
    expect(result.state.pendingFailures).toHaveLength(0);
  });

  it('limits allowed mentions to the failed user and uses the exact failure text', async () => {
    const adapter = new MockAdapter();
    await execute(adapter);

    expect(adapter.sendAnnouncement).toHaveBeenCalledWith({
      failedMessageId: '100',
      failedUserId: '30',
      content:
        '<:failure:50><:failure:50><:failure:50>' +
        '<@30> が失敗した!!️' +
        '<:failure:50><:failure:50><:failure:50>',
      allowedMentions: {
        users: ['30'],
        roles: [],
        repliedUser: false,
      },
    });
  });

  it('persists progress after each side effect before removing the pending record', async () => {
    const adapter = new MockAdapter();
    const result = await execute(adapter);

    expect(result.writes.length).toBeGreaterThanOrEqual(4);
    expect(result.writes[0]?.pendingFailures[0]?.roleStatus).toBe('succeeded');
    expect(result.writes[1]?.pendingFailures[0]?.timeoutStatus).toBe('succeeded');
    expect(result.writes[2]?.pendingFailures[0]?.announcementStatus).toBe('succeeded');
    expect(result.writes.at(-1)?.pendingFailures).toHaveLength(0);
  });
});
