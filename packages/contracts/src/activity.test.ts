import { activityExchangeRequestSchema, activityExchangeResponseSchema } from './activity.js';

describe('Discord Activity contracts', () => {
  it('accepts the minimal OAuth exchange and optional verified location hints', () => {
    expect(
      activityExchangeRequestSchema.parse({
        code: 'authorization-code',
        instanceId: 'i-activity-instance',
      }),
    ).toEqual({ code: 'authorization-code', instanceId: 'i-activity-instance' });
    expect(
      activityExchangeRequestSchema.safeParse({
        code: 'authorization-code',
        instanceId: 'i-activity-instance',
        launchId: 'not-a-snowflake',
      }).success,
    ).toBe(false);
  });

  it('describes the SDK token and race-scoped Activity session response', () => {
    expect(
      activityExchangeResponseSchema.parse({
        accessToken: 'discord-token',
        csrfToken: 'c'.repeat(40),
        raceId: 'race-1',
        expiresAt: 1_000,
        edgeAccessToken: 'edge-token',
      }),
    ).toMatchObject({ raceId: 'race-1', expiresAt: 1_000 });
  });
});
