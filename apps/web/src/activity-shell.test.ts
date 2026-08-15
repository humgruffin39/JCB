import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api.js';
import type { ActivityPlatform } from './activity-platform.js';
import { activityErrorState, authorizeActivitySession } from './activity-shell.js';

describe('Activity session bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exchanges Discord authorization and authenticates the SDK without navigation', async () => {
    stubExchange({
      accessToken: 'discord-access',
      csrfToken: 'activity-csrf-token-with-at-least-forty-characters',
      raceId: 'race-1',
      expiresAt: 1_787_300_000_000,
    });
    const authenticate = vi.fn().mockResolvedValue({ id: 'user-1' });
    const platform = platformMock({ authenticate });

    await expect(authorizeActivitySession(platform)).resolves.toEqual({ raceId: 'race-1' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/activity/exchange',
      expect.objectContaining({
        body: JSON.stringify({
          code: 'oauth-code',
          instanceId: 'instance-1',
          launchId: '1001',
          guildId: '1002',
          channelId: '1003',
        }),
      }),
    );
    expect(authenticate).toHaveBeenCalledWith('discord-access');
  });

  it('omits unavailable optional Discord context instead of sending empty values', async () => {
    stubExchange({
      accessToken: 'discord-access',
      csrfToken: 'activity-csrf-token-with-at-least-forty-characters',
      raceId: 'race-1',
      expiresAt: 1_787_300_000_000,
    });
    const platform = platformMock({
      launchId: undefined,
      guildId: undefined,
      channelId: undefined,
    });

    await authorizeActivitySession(platform);

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/activity/exchange',
      expect.objectContaining({
        body: JSON.stringify({ code: 'oauth-code', instanceId: 'instance-1' }),
      }),
    );
  });
});

describe('Activity error copy', () => {
  it('gives a permanent membership error without offering a misleading retry', () => {
    expect(
      activityErrorState(
        new ApiRequestError('membership required', 403, 'GUILD_MEMBERSHIP_REQUIRED'),
      ),
    ).toEqual({
      status: 'unavailable',
      heading: 'このサーバーでは観戦できません',
      message: 'ジョサン中央銀行のDiscordサーバーから開いてください。',
    });
  });

  it('directs stale launches back to the race message', () => {
    expect(
      activityErrorState(new ApiRequestError('launch missing', 410, 'ACTIVITY_LAUNCH_NOT_FOUND')),
    ).toMatchObject({ status: 'unavailable', heading: '観戦するレースがありません' });
  });

  it('keeps network and authorization errors retryable', () => {
    expect(activityErrorState(new TypeError('Failed to fetch'))).toMatchObject({
      status: 'error',
      heading: '接続できませんでした',
    });
    expect(
      activityErrorState(new ApiRequestError('OAuth failed', 401, 'ACTIVITY_AUTHORIZATION_FAILED')),
    ).toMatchObject({ status: 'error' });
  });
});

function platformMock(overrides: Partial<ActivityPlatform> = {}): ActivityPlatform {
  return {
    instanceId: 'instance-1',
    launchId: '1001',
    guildId: '1002',
    channelId: '1003',
    ready: vi.fn().mockResolvedValue(undefined),
    authorize: vi.fn().mockResolvedValue({ code: 'oauth-code' }),
    authenticate: vi.fn().mockResolvedValue({ id: 'user-1' }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function stubExchange(result: {
  readonly accessToken: string;
  readonly csrfToken: string;
  readonly raceId: string;
  readonly expiresAt: number;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ apiVersion: 'v1', result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}
