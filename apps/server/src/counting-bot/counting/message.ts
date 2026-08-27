export interface CountMessage {
  readonly id: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorDisplayName: string;
  readonly authorIsBot: boolean;
  readonly webhookId: string | null;
  readonly isSystem: boolean;
  readonly content: string;
  readonly createdTimestamp: number;
  readonly attachmentCount: number;
  readonly stickerCount: number;
  readonly hasPoll: boolean;
}
