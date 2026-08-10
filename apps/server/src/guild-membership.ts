import type { GuildMembership } from '@jcb/application';
import type { Client } from 'discord.js';

export class DiscordClientGuildMembership implements GuildMembership {
  public constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  public async isCurrentMember(discordUserId: string): Promise<boolean> {
    const guild = await this.client.guilds.fetch(this.guildId);
    try {
      await guild.members.fetch(discordUserId);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 10_007 || error.code === 50_001)
      ) {
        return false;
      }
      throw error;
    }
  }
}
