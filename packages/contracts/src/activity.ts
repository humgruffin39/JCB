import { z } from 'zod';
import { timestampSchema } from './common.js';

const snowflakeSchema = z.string().regex(/^\d+$/);

export const activityExchangeRequestSchema = z
  .object({
    code: z.string().min(1).max(512),
    instanceId: z.string().min(1).max(256),
    launchId: snowflakeSchema.optional(),
    guildId: snowflakeSchema.optional(),
    channelId: snowflakeSchema.optional(),
  })
  .strict();

export const activityExchangeResponseSchema = z.object({
  accessToken: z.string().min(1),
  csrfToken: z.string().min(40).max(200),
  raceId: z.string().min(1),
  expiresAt: timestampSchema,
  edgeAccessToken: z.string().min(1).optional(),
});

export type ActivityExchangeRequest = z.infer<typeof activityExchangeRequestSchema>;
export type ActivityExchangeResponse = z.infer<typeof activityExchangeResponseSchema>;
