import { EmbedBuilder } from 'discord.js';
import {
  distancePreferenceScore,
  surfacePreferenceScore,
  type HorseAbilities,
  type RunningStyle,
  type Surface,
} from '@jcb/domain';
import { horseNumberEmoji } from './horse-number-emoji.js';

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
  const embed = new EmbedBuilder()
    .setTitle('出走馬情報')
    .addFields(
      race.entries.map((entry) => ({
        name: `${horseNumberEmoji(entry.horseNumber)} ${entry.name}`,
        value: formatHorseInfoValue(entry, race.distanceM, race.surface),
        inline: false,
      })),
    )
    .setColor(0x25d9ff);
  return { embeds: [embed] };
}

function formatHorseInfoValue(
  entry: DiscordHorseInfoEntry,
  distanceM: number,
  surface: Surface,
): string {
  return [
    runningStyleLabel(entry.runningStyle),
    `距離 ${distancePreferenceMark(distancePreferenceScore(entry, distanceM))}`,
    `${surfaceShortLabel(surface)} ${surfacePreferenceMark(surfacePreferenceScore(entry, surface))}`,
  ].join('　');
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

function surfaceShortLabel(surface: Surface): '芝' | 'ダート' {
  return surface === 'turf' ? '芝' : 'ダート';
}
