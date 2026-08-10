export interface GuildMembership {
  isCurrentMember(discordUserId: string): Promise<boolean>;
}

export interface AdminAuthorization {
  isAdmin(discordUserId: string): Promise<boolean>;
}
