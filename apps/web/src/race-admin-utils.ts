import { conditionLabel } from './admin-labels.js';
import type { AdminRace, HorseOption, RaceEntrySelection } from './race-admin-model.js';

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
  return /^\d+$/.test(value) ? `${BigInt(value).toLocaleString('ja-JP')} CP` : value;
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

/**
 * Picks a field with both running styles represented.
 *
 * A field of only front runners settles into a procession and one of only
 * closers bunches up early, so an even split gives the race a shape worth
 * watching. When one style cannot fill its half the rest comes from the other,
 * and the result is shuffled again so the styles are not grouped by gate.
 */
export function selectBalancedField(
  horses: readonly HorseOption[],
  size: number,
  shuffle: <T>(items: readonly T[]) => T[],
): readonly HorseOption[] {
  // Partitioning on one side keeps the two groups exhaustive, so an unexpected
  // running style still gets a gate instead of silently emptying the field.
  const frontRunners = shuffle(horses.filter((horse) => horse.runningStyle === 'front_runner'));
  const closers = shuffle(horses.filter((horse) => horse.runningStyle !== 'front_runner'));
  const fromFront = frontRunners.slice(0, Math.floor(size / 2));
  const fromClosers = closers.slice(0, size - fromFront.length);
  const picked = [...fromFront, ...fromClosers];
  if (picked.length < size) {
    const leftovers = shuffle([
      ...frontRunners.slice(fromFront.length),
      ...closers.slice(fromClosers.length),
    ]);
    picked.push(...leftovers.slice(0, size - picked.length));
  }
  return shuffle(picked);
}
