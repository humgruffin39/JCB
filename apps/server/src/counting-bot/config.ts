import type { Environment } from '@jcb/config';

export interface Config {
  readonly guildId: string;
  readonly countChannelId: string;
  readonly penaltyRoleId: string;
  readonly failureEmojiId: string;
  readonly consecutiveWarningEmojiId: string;
  readonly timeoutSeconds: number;
  readonly initialCount: string;
}

const DEFAULT_CONSECUTIVE_WARNING_EMOJI_ID = '1432393358214692926';

export function loadCountingConfig(environment: Environment): Config | null {
  const channelId = environment.COUNT_CHANNEL_ID;
  if (channelId === undefined) return null;

  const guildId = requireValue(environment.DISCORD_GUILD_ID, 'DISCORD_GUILD_ID');
  const penaltyRoleId = requireValue(environment.COUNT_PENALTY_ROLE_ID, 'COUNT_PENALTY_ROLE_ID');
  const failureEmojiId = requireValue(environment.COUNT_FAILURE_EMOJI_ID, 'COUNT_FAILURE_EMOJI_ID');

  return {
    guildId,
    countChannelId: channelId,
    penaltyRoleId,
    failureEmojiId,
    consecutiveWarningEmojiId:
      environment.COUNT_CONSECUTIVE_WARNING_EMOJI_ID ?? DEFAULT_CONSECUTIVE_WARNING_EMOJI_ID,
    timeoutSeconds: environment.COUNT_TIMEOUT_SECONDS,
    initialCount: environment.COUNT_INITIAL_COUNT,
  };
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required for Counting Bot integration.`);
  return value;
}
