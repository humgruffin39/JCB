import type { Environment } from '@jcb/config';
import { z } from 'zod';

const oauthTokenSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
  })
  .passthrough();

const discordProfileSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    username: z.string().min(1).max(80),
    global_name: z.string().max(80).nullable().optional(),
  })
  .passthrough();

const activityInstanceSchema = z.object({
  application_id: z.string().regex(/^\d+$/),
  instance_id: z.string().min(1).max(256),
  launch_id: z.string().regex(/^\d+$/),
  location: z.object({
    id: z.string().min(1),
    kind: z.enum(['gc', 'pc']),
    channel_id: z.string().regex(/^\d+$/),
    guild_id: z.string().regex(/^\d+$/).nullable().optional(),
  }),
  users: z.array(z.string().regex(/^\d+$/)),
});

export interface DiscordActivityOAuthToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresIn?: number;
}

export interface DiscordActivityProfile {
  readonly id: string;
  readonly username: string;
  readonly globalName?: string;
}

export interface DiscordActivityInstance {
  readonly applicationId: string;
  readonly instanceId: string;
  readonly launchId: string;
  readonly location: {
    readonly kind: 'gc' | 'pc';
    readonly channelId: string;
    readonly guildId?: string;
  };
  readonly userIds: readonly string[];
}

export interface DiscordActivityApi {
  exchangeCode(code: string): Promise<DiscordActivityOAuthToken>;
  getCurrentUser(token: DiscordActivityOAuthToken): Promise<DiscordActivityProfile>;
  getActivityInstance(instanceId: string): Promise<DiscordActivityInstance>;
}

export class DiscordHttpActivityApi implements DiscordActivityApi {
  public constructor(private readonly environment: Environment) {}

  public async exchangeCode(code: string): Promise<DiscordActivityOAuthToken> {
    const clientId = requireSetting(this.environment.DISCORD_CLIENT_ID, 'DISCORD_CLIENT_ID');
    const clientSecret = requireSetting(
      this.environment.DISCORD_CLIENT_SECRET,
      'DISCORD_CLIENT_SECRET',
    );
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
    });
    if (!response.ok) throw new DiscordActivityApiError('OAUTH_EXCHANGE_FAILED', response.status);
    const token = oauthTokenSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      tokenType: token.token_type,
      ...(token.expires_in === undefined ? {} : { expiresIn: token.expires_in }),
    };
  }

  public async getCurrentUser(token: DiscordActivityOAuthToken): Promise<DiscordActivityProfile> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `${token.tokenType} ${token.accessToken}` },
    });
    if (!response.ok) throw new DiscordActivityApiError('PROFILE_FAILED', response.status);
    const profile = discordProfileSchema.parse(await response.json());
    return {
      id: profile.id,
      username: profile.username,
      ...(profile.global_name == null ? {} : { globalName: profile.global_name }),
    };
  }

  public async getActivityInstance(instanceId: string): Promise<DiscordActivityInstance> {
    const clientId = requireSetting(this.environment.DISCORD_CLIENT_ID, 'DISCORD_CLIENT_ID');
    const botToken = requireSetting(this.environment.DISCORD_BOT_TOKEN, 'DISCORD_BOT_TOKEN');
    const response = await fetch(
      `https://discord.com/api/v10/applications/${encodeURIComponent(clientId)}/activity-instances/${encodeURIComponent(instanceId)}`,
      { headers: { authorization: `Bot ${botToken}` } },
    );
    if (!response.ok) throw new DiscordActivityApiError('INSTANCE_FAILED', response.status);
    const instance = activityInstanceSchema.parse(await response.json());
    return {
      applicationId: instance.application_id,
      instanceId: instance.instance_id,
      launchId: instance.launch_id,
      location: {
        kind: instance.location.kind,
        channelId: instance.location.channel_id,
        ...(instance.location.guild_id == null ? {} : { guildId: instance.location.guild_id }),
      },
      userIds: instance.users,
    };
  }
}

export class DiscordActivityApiError extends Error {
  public constructor(
    public readonly reason: 'OAUTH_EXCHANGE_FAILED' | 'PROFILE_FAILED' | 'INSTANCE_FAILED',
    public readonly responseStatus: number,
  ) {
    super(`Discord Activity API request failed: ${reason} (${String(responseStatus)}).`);
  }
}

function requireSetting(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is not configured.`);
  return value;
}
