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
export const timestampSchema = z.number().int().safe().nonnegative();
export const jstDateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, 'Date must be a real Gregorian calendar date.');
export const raceIdParamsSchema = z.object({ raceId: z.string().min(1).max(80) });
export const jobIdParamsSchema = z.object({ jobId: z.string().min(1).max(80) });

function isCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}
