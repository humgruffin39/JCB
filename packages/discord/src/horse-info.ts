import { EmbedBuilder } from 'discord.js';
import {
  distancePreferenceScore,
  surfacePreferenceScore,
  type HorseAbilities,
  type RunningStyle,
  type Surface,
} from '@jcb/domain';

export interface DiscordHorseInfoEntry extends HorseAbilities {
  readonly horseNumber: number;
  readonly name: string;
  readonly runningStyle: RunningStyle;
}

export interface DiscordHorseInfoRace {
  readonly distanceM: number;
  readonly surface: Surface;
  readonly entries: readonly DiscordHorseInfoEntry[];
}

export interface DiscordHorseInfoMessage {
  readonly embeds: readonly [EmbedBuilder];
}

const DISTANCE_MARK_THRESHOLD = 0.15;
const SURFACE_MARK_THRESHOLD = 1 / 3;

export function renderHorseInfoMessage(race: DiscordHorseInfoRace): DiscordHorseInfoMessage {
  if (race.entries.length !== 8) {
    throw new Error('Horse information requires exactly eight entries.');
  }
  const description = [
    `${String(race.distanceM)}m / ${surfaceHeaderLabel(race.surface)}`,
    '',
    ...race.entries.map((entry) => formatHorseInfoLine(entry, race.distanceM, race.surface)),
  ].join('\n');
  const embed = new EmbedBuilder()
    .setTitle('出走馬情報')
    .setDescription(description)
    .setColor(0x25d9ff);
  return { embeds: [embed] };
}

export function formatHorseInfoLine(
  entry: DiscordHorseInfoEntry,
  distanceM: number,
  surface: Surface,
): string {
  return [
    `\`${String(entry.horseNumber).padStart(2, '0')}\` ${entry.name}`,
    `脚質 ${runningStyleLabel(entry.runningStyle)}`,
    `距離適性 ${distancePreferenceMark(distancePreferenceScore(entry, distanceM))}`,
    `馬場適性 ${surfaceShortLabel(surface)}${surfacePreferenceMark(surfacePreferenceScore(entry, surface))}`,
    `持ち味 ${horseStrength(entry)}`,
  ].join('｜');
}

export function runningStyleLabel(style: RunningStyle): '逃げ' | '差し' {
  return style === 'front_runner' ? '逃げ' : '差し';
}

export function preferenceMark(score: number, threshold = SURFACE_MARK_THRESHOLD): '◎' | '○' | '△' {
  if (score >= threshold) return '◎';
  if (score <= -threshold) return '△';
  return '○';
}

export function distancePreferenceMark(score: number): '◎' | '○' | '△' {
  return preferenceMark(score, DISTANCE_MARK_THRESHOLD);
}

export function surfacePreferenceMark(score: number): '◎' | '○' | '△' {
  return preferenceMark(score, SURFACE_MARK_THRESHOLD);
}

export function horseStrength(
  entry: DiscordHorseInfoEntry,
): 'スピード' | '先行力' | 'スタミナ' | '末脚' | '安定感' {
  const candidates: readonly {
    readonly label: 'スピード' | '先行力' | 'スタミナ' | '末脚' | '安定感';
    readonly score: number;
  }[] = [
    { label: 'スピード', score: entry.speed },
    { label: '先行力', score: (entry.start + entry.acceleration) / 2 },
    { label: 'スタミナ', score: entry.stamina },
    { label: '末脚', score: entry.lateKick },
    { label: '安定感', score: entry.conditionStability },
  ];
  return candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best))
    .label;
}

function surfaceHeaderLabel(surface: Surface): '芝' | 'ダート' {
  return surface === 'turf' ? '芝' : 'ダート';
}

function surfaceShortLabel(surface: Surface): '芝' | 'ダ' {
  return surface === 'turf' ? '芝' : 'ダ';
}
