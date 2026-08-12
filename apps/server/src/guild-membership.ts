import type { GuildMembership } from '@jcb/application';
import type { Client } from 'discord.js';

export class DiscordClientGuildMembership implements GuildMembership {
  public constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  public async isCurrentMember(discordUserId: string): Promise<boolean> {
    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.members.fetch({ user: discordUserId, force: true, cache: false });
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 10_007) return false;
        if (error.code === 50_001) {
          throw Object.assign(new Error('Discord guild access is currently unavailable.'), {
            statusCode: 503,
            code: 'DISCORD_GUILD_ACCESS_UNAVAILABLE',
          });
        }
      }
      throw error;
    }
  }
}
