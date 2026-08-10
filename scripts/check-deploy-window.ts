import { timestamp, toJstDateKey } from '@jcb/domain';

const now = Date.now();
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).formatToParts(now);
const hour = Number(parts.find((part) => part.type === 'hour')?.value);
const minute = Number(parts.find((part) => part.type === 'minute')?.value);
const minutes = hour * 60 + minute;
const blackout = minutes >= 21 * 60 + 30 && minutes < 22 * 60 + 15;
const emergencyReason = process.env.EMERGENCY_DEPLOY_REASON?.trim();

if (blackout) {
  if (emergencyReason === undefined) {
    throw new Error(
      `Production deploy is blocked during 21:30–22:15 JST (${toJstDateKey(timestamp(now))}). ` +
        'Set EMERGENCY_DEPLOY_REASON only for an approved emergency.',
    );
  }
  if (emergencyReason.length < 10) {
    throw new Error('EMERGENCY_DEPLOY_REASON must contain at least 10 characters.');
  }
}

process.stdout.write(
  blackout
    ? `Emergency deploy window override recorded: ${emergencyReason}\n`
    : 'Production deploy window is open.\n',
);
