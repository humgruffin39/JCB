import { conditionLabel } from './admin-labels.js';
import type { AdminRace, RaceEntrySelection } from './race-admin-model.js';

export function surfaceLabel(surface: AdminRace['surface']): string {
  return surface === 'turf' ? '芝' : 'ダート';
}

export function formatDateKeyForDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null ? value : `${match[1]}/${match[2]}/${match[3]}`;
}

export function entriesFor(race: AdminRace | undefined): readonly RaceEntrySelection[] {
  if (race === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(race.entriesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry: unknown): entry is RaceEntrySelection => {
        if (typeof entry !== 'object' || entry === null) return false;
        const record = entry as Record<string, unknown>;
        return (
          typeof record.horseId === 'string' &&
          typeof record.horseNumber === 'number' &&
          Number.isInteger(record.horseNumber) &&
          record.horseNumber >= 1 &&
          record.horseNumber <= 8
        );
      })
      .sort((left, right) => left.horseNumber - right.horseNumber);
  } catch {
    return [];
  }
}

export function formatOddsRange(race: AdminRace): string {
  if (race.minimumBaseOdds === null || race.maximumBaseOdds === null) return '未生成';
  const minimum = Number(race.minimumBaseOdds);
  const maximum = Number(race.maximumBaseOdds);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return '未生成';
  return `${minimum.toFixed(1)}–${maximum.toFixed(1)}倍 / ${race.oddsSelectionCount}通り`;
}

export function formatRupees(value: string): string {
  return /^\d+$/.test(value) ? `${BigInt(value).toLocaleString('ja-JP')} R` : value;
}

export function formatSeedLiquidity(race: AdminRace): string {
  if (race.seedLiquidityDiagnosticsJson === null) return formatRupees(race.seedLiquidity);
  try {
    const diagnostics = JSON.parse(race.seedLiquidityDiagnosticsJson) as Record<string, unknown>;
    const applied = Number(diagnostics.appliedWin ?? 0) + Number(diagnostics.appliedTrifecta ?? 0);
    return formatRupees(String(applied));
  } catch {
    return formatRupees(race.seedLiquidity);
  }
}

export function moveTimestampToJstDate(timestampValue: string, raceDate: string): number {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(Number(timestampValue)));
  return Date.parse(`${raceDate}T${time}+09:00`);
}

export function raceKindForDate(raceDate: string): 'regular' | 'midweek' | 'saturday_night' {
  const day = new Date(`${raceDate}T12:00:00+09:00`).getUTCDay();
  return day === 3 ? 'midweek' : day === 6 ? 'saturday_night' : 'regular';
}

export function formatConditionReadout(race: AdminRace): string {
  return entriesFor(race)
    .map((entry) => `${String(entry.horseNumber)}番 ${conditionLabel(entry.condition)}`)
    .join(' / ');
}
