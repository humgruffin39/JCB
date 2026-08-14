import type { BotState } from '../persistence/stateSchema.js';

export const legendHistory20260801ImportId = 'legend-2026-08-01-2309-through-count-144';

const targetGuildId = '1329013463175139380';
const targetChannelId = '1533056797504569545';

const importedSuccessfulCounts: Readonly<Record<string, string>> = {
  '924311449973686282': '34',
  '963427109601181706': '20',
  '1002017915480068277': '18',
  '1062730384997097552': '17',
  '703821433934970920': '16',
  '1244258956914720769': '13',
  '1197747392167026701': '11',
  '1101493448206471188': '9',
  '1316298099437600851': '4',
  '1263762931925909534': '1',
  '982564395127291924': '1',
};

export interface HistoryImportResult {
  readonly state: BotState;
  readonly applied: boolean;
  readonly importedCount: string;
}

export function applyLegendHistory20260801(state: BotState, now = new Date()): HistoryImportResult {
  if (
    state.guildId !== targetGuildId ||
    state.channelId !== targetChannelId ||
    state.appliedHistoryImports.includes(legendHistory20260801ImportId)
  ) {
    return { state, applied: false, importedCount: '0' };
  }

  const mergedCounts: Record<string, string> = {
    ...state.successfulCounts,
  };
  let importedCount = 0n;

  for (const [userId, count] of Object.entries(importedSuccessfulCounts)) {
    mergedCounts[userId] = (BigInt(mergedCounts[userId] ?? '0') + BigInt(count)).toString();
    importedCount += BigInt(count);
  }

  return {
    state: {
      ...state,
      successfulCounts: mergedCounts,
      appliedHistoryImports: [...state.appliedHistoryImports, legendHistory20260801ImportId],
      updatedAt: now.toISOString(),
    },
    applied: true,
    importedCount: importedCount.toString(),
  };
}
