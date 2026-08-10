import { DomainError } from './errors.js';

export type PoolType = 'win' | 'trifecta';

export function winSelection(horseNumber: number): string {
  validateHorseNumber(horseNumber);
  return String(horseNumber);
}

export function trifectaSelection(first: number, second: number, third: number): string {
  validateHorseNumber(first);
  validateHorseNumber(second);
  validateHorseNumber(third);
  if (new Set([first, second, third]).size !== 3) {
    throw new DomainError('INVALID_SELECTION', 'Trifecta positions must contain distinct horses.');
  }
  return `${first}-${second}-${third}`;
}

export function allTrifectaSelections(): readonly string[] {
  const selections: string[] = [];
  for (let first = 1; first <= 8; first += 1) {
    for (let second = 1; second <= 8; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 8; third += 1) {
        if (third === first || third === second) continue;
        selections.push(trifectaSelection(first, second, third));
      }
    }
  }
  return selections;
}

function validateHorseNumber(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new DomainError('INVALID_SELECTION', 'Horse number must be an integer from 1 to 8.');
  }
}
