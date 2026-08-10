import { z } from 'zod';

export const apiEnvelopeSchema = <Output extends z.ZodType>(output: Output) =>
  z.object({
    apiVersion: z.literal('v1'),
    result: output,
  });

export const apiErrorSchema = z.object({
  apiVersion: z.literal('v1'),
  error: z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(300),
  }),
});

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export const discordIdSchema = z.string().regex(/^\d{5,25}$/);
export const moneyStringSchema = z.string().regex(/^\d+$/);
export const timestampSchema = z.number().int().nonnegative();
export const raceIdParamsSchema = z.object({ raceId: z.string().min(1).max(80) });
export const jobIdParamsSchema = z.object({ jobId: z.string().min(1).max(80) });
