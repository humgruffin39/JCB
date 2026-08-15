import { parseEnvironment } from '@jcb/config';
import { afterEach, vi } from 'vitest';
import { DiscordHttpActivityApi } from './discord-activity-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Discord Activity HTTP API', () => {
  it('exchanges the SDK code and verifies both the user and Activity instance', async () => {
    const responses = [
      Response.json({ access_token: 'access', token_type: 'Bearer', expires_in: 3_600 }),
      Response.json({ id: '100', username: 'viewer', global_name: 'Viewer' }),
      Response.json({
        application_id: '500',
        instance_id: 'instance-1',
        launch_id: '600',
        location: {
          id: 'gc-200-300',
          kind: 'gc',
          guild_id: '200',
          channel_id: '300',
        },
        users: ['100'],
      }),
    ];
    const calls: Array<readonly [Parameters<typeof fetch>[0], Parameters<typeof fetch>[1]]> = [];
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ): Promise<Response> => {
        calls.push([input, init]);
        return responses.shift()!;
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new DiscordHttpActivityApi(
      parseEnvironment({
        NODE_ENV: 'test',
        DISCORD_CLIENT_ID: '500',
        DISCORD_CLIENT_SECRET: 'client-secret',
        DISCORD_BOT_TOKEN: 'bot-secret',
      }),
    );

    const token = await api.exchangeCode('sdk-code');
    expect(token).toEqual({ accessToken: 'access', tokenType: 'Bearer', expiresIn: 3_600 });
    expect(await api.getCurrentUser(token)).toEqual({
      id: '100',
      username: 'viewer',
      globalName: 'Viewer',
    });
    expect(await api.getActivityInstance('instance-1')).toMatchObject({
      applicationId: '500',
      launchId: '600',
      location: { guildId: '200', channelId: '300' },
      userIds: ['100'],
    });

    const tokenRequest = calls[0];
    expect(tokenRequest?.[0]).toBe('https://discord.com/api/v10/oauth2/token');
    expect(String(tokenRequest?.[1]?.body)).toContain('code=sdk-code');
    const instanceRequest = calls[2];
    expect(instanceRequest?.[0]).toContain('/applications/500/activity-instances/instance-1');
    expect(instanceRequest?.[1]?.headers).toEqual({
      authorization: 'Bot bot-secret',
    });
  });
});
