import type { Client } from 'discord.js';

export async function assignRacingRole(input: {
  readonly client: Client;
  readonly guildId: string;
  readonly discordUserId: string;
  readonly roleId: string;
}): Promise<void> {
  const guild = await input.client.guilds.fetch(input.guildId);
  const member = await guild.members.fetch({
    user: input.discordUserId,
    force: true,
    cache: false,
  });
  if (member.roles.cache.has(input.roleId)) return;
  await member.roles.add(input.roleId, 'Racing participant');
}
