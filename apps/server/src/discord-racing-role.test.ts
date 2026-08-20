import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { assignRacingRole } from './discord-racing-role.js';

function createClient(hasRole: boolean) {
  const add = vi.fn().mockResolvedValue(undefined);
  const member = {
    roles: {
      cache: { has: vi.fn().mockReturnValue(hasRole) },
      add,
    },
  };
  const memberFetch = vi.fn().mockResolvedValue(member);
  const guildFetch = vi.fn().mockResolvedValue({ members: { fetch: memberFetch } });
  const client = { guilds: { fetch: guildFetch } } as unknown as Client;
  return { add, memberFetch, guildFetch, client };
}

describe('assignRacingRole', () => {
  it('does not add the role when the member already has it', async () => {
    const { add, memberFetch, guildFetch, client } = createClient(true);

    await assignRacingRole({
      client,
      guildId: 'guild-id',
      discordUserId: 'user-id',
      roleId: 'role-id',
    });

    expect(guildFetch).toHaveBeenCalledWith('guild-id');
    expect(memberFetch).toHaveBeenCalledWith({
      user: 'user-id',
      force: true,
      cache: false,
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('adds the role when the member does not have it', async () => {
    const { add, client } = createClient(false);

    await assignRacingRole({
      client,
      guildId: 'guild-id',
      discordUserId: 'user-id',
      roleId: 'role-id',
    });

    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('role-id', 'Racing participant');
  });
});
