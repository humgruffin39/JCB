import { describe, expect, it } from 'vitest';
import { activityLaunchContext, isDiscordActivityLaunch } from './activity-launch.js';

describe('Discord Activity launch detection', () => {
  it('requires Discord’s complete SDK launch tuple', () => {
    expect(
      isDiscordActivityLaunch('?frame_id=frame-1&instance_id=instance-1&platform=mobile'),
    ).toBe(true);
    expect(isDiscordActivityLaunch('?instance_id=instance-1&platform=mobile')).toBe(false);
    expect(isDiscordActivityLaunch('?frame_id=frame-1&instance_id=instance-1')).toBe(false);
    expect(
      isDiscordActivityLaunch('?frame_id=frame-1&instance_id=instance-1&platform=browser'),
    ).toBe(false);
  });

  it('keeps normal browser URLs on the existing flow', () => {
    expect(isDiscordActivityLaunch('?raceId=race-1')).toBe(false);
    expect(isDiscordActivityLaunch('')).toBe(false);
  });

  it('reads only the trusted launch context fields sent to the backend', () => {
    expect(
      activityLaunchContext(
        '?frame_id=frame-1&instance_id=instance-1&platform=desktop&launch_id=1001&guild_id=1002&channel_id=1003&custom_id=ignored',
      ),
    ).toEqual({
      instanceId: 'instance-1',
      launchId: '1001',
      guildId: '1002',
      channelId: '1003',
    });
  });
});
