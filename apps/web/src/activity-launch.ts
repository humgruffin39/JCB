export interface ActivityLaunchContext {
  readonly instanceId: string;
  readonly launchId?: string;
  readonly guildId?: string;
  readonly channelId?: string;
}

const DISCORD_PLATFORMS = new Set(['desktop', 'mobile']);

/**
 * Discord supplies all three values when it embeds an Activity. Requiring the
 * complete SDK launch tuple keeps ordinary links and test URLs on the browser
 * flow even when they happen to contain one similarly named query parameter.
 */
export function isDiscordActivityLaunch(search: string): boolean {
  const parameters = new URLSearchParams(search);
  return (
    hasValue(parameters, 'frame_id') &&
    hasValue(parameters, 'instance_id') &&
    DISCORD_PLATFORMS.has(parameters.get('platform') ?? '')
  );
}

export function activityLaunchContext(search: string): ActivityLaunchContext | undefined {
  if (!isDiscordActivityLaunch(search)) return undefined;
  const parameters = new URLSearchParams(search);
  const instanceId = parameters.get('instance_id')!;
  return {
    instanceId,
    ...optionalField('launchId', parameters.get('launch_id')),
    ...optionalField('guildId', parameters.get('guild_id')),
    ...optionalField('channelId', parameters.get('channel_id')),
  };
}

function hasValue(parameters: URLSearchParams, name: string): boolean {
  return (parameters.get(name)?.trim().length ?? 0) > 0;
}

function optionalField<Key extends string>(
  key: Key,
  value: string | null,
): Partial<Record<Key, string>> {
  return value === null || value.trim() === '' ? {} : ({ [key]: value } as Record<Key, string>);
}
