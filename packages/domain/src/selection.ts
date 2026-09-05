import { DomainError } from './errors.js';

export const POOL_TYPES = [
  'win',
  'place',
  'quinella',
  'exacta',
  'wide',
  'trio',
  'trifecta',
] as const;

export type PoolType = (typeof POOL_TYPES)[number];

export interface PoolTypeDefinition {
  readonly label: string;
  readonly description: string;
  readonly selectionSize: 1 | 2 | 3;
  readonly ordered: boolean;
  /**
   * How many selections win a single race. Pools that pay out more than one
   * selection split their balance into that many equal sub-pools, so both the
   * displayed odds and the settlement divide by this number.
   */
  readonly winningSelectionCount: 1 | 3;
}

export const POOL_TYPE_DEFINITIONS: Readonly<Record<PoolType, PoolTypeDefinition>> = {
  win: {
    label: '単勝',
    description: '1着になる馬を、1頭当てる馬券。',
    selectionSize: 1,
    ordered: true,
    winningSelectionCount: 1,
  },
  place: {
    label: '複勝',
    description: '3着までに入る馬を、1頭当てる馬券。',
    selectionSize: 1,
    ordered: false,
    winningSelectionCount: 3,
  },
  quinella: {
    label: '馬連',
    description: '1着と2着になる2頭を、着順を問わずに当てる馬券。',
    selectionSize: 2,
    ordered: false,
    winningSelectionCount: 1,
  },
  exacta: {
    label: '馬単',
    description: '1着と2着になる2頭を、着順通りに当てる馬券。',
    selectionSize: 2,
    ordered: true,
    winningSelectionCount: 1,
  },
  wide: {
    label: 'ワイド',
    description: '3着までに入る2頭を、着順を問わずに当てる馬券。',
    selectionSize: 2,
    ordered: false,
    winningSelectionCount: 3,
  },
  trio: {
    label: '3連複',
    description: '1着・2着・3着になる3頭を、着順を問わずに当てる馬券。',
    selectionSize: 3,
    ordered: false,
    winningSelectionCount: 1,
  },
  trifecta: {
    label: '3連単',
    description: '1着・2着・3着になる3頭を、着順通りに当てる馬券。',
    selectionSize: 3,
    ordered: true,
    winningSelectionCount: 1,
  },
};

export function isPoolType(value: string): value is PoolType {
  return (POOL_TYPES as readonly string[]).includes(value);
}

export function selectionCode(poolType: PoolType, horseNumbers: readonly number[]): string {
  const definition = POOL_TYPE_DEFINITIONS[poolType];
  if (horseNumbers.length !== definition.selectionSize) {
    throw new DomainError('INVALID_SELECTION', 'Selection contains the wrong number of horses.');
  }
  for (const horseNumber of horseNumbers) validateHorseNumber(horseNumber);
  if (new Set(horseNumbers).size !== horseNumbers.length) {
    throw new DomainError('INVALID_SELECTION', 'Selection must contain distinct horses.');
  }
  return selectionCodeFromValidatedHorses(poolType, horseNumbers);
}

function selectionCodeFromValidatedHorses(
  poolType: PoolType,
  horseNumbers: readonly number[],
): string {
  const definition = POOL_TYPE_DEFINITIONS[poolType];
  const normalized = definition.ordered ? horseNumbers : [...horseNumbers].sort((a, b) => a - b);
  return normalized.join('-');
}

export function allSelections(poolType: PoolType): readonly string[] {
  const definition = POOL_TYPE_DEFINITIONS[poolType];
  const selections: string[] = [];
  const build = (chosen: readonly number[]): void => {
    if (chosen.length === definition.selectionSize) {
      selections.push(selectionCode(poolType, chosen));
      return;
    }
    for (let horseNumber = 1; horseNumber <= 8; horseNumber += 1) {
      if (chosen.includes(horseNumber)) continue;
      if (!definition.ordered && chosen.length > 0 && horseNumber < chosen.at(-1)!) continue;
      build([...chosen, horseNumber]);
    }
  };
  build([]);
  return selections;
}

export function winningSelections(
  poolType: PoolType,
  finishOrder: readonly number[],
): readonly string[] {
  validateFinishOrder(finishOrder);
  return winningSelectionsFromValidatedOrder(poolType, finishOrder);
}

export function winningSelectionsByPool(
  finishOrder: readonly number[],
): Readonly<Record<PoolType, readonly string[]>> {
  validateFinishOrder(finishOrder);
  return Object.fromEntries(
    POOL_TYPES.map((poolType) => [
      poolType,
      winningSelectionsFromValidatedOrder(poolType, finishOrder),
    ]),
  ) as Record<PoolType, readonly string[]>;
}

function validateFinishOrder(finishOrder: readonly number[]): void {
  if (finishOrder.length !== 8 || new Set(finishOrder).size !== finishOrder.length) {
    throw new DomainError('INVALID_SELECTION', 'Finish order is invalid.');
  }
  for (const horseNumber of finishOrder) validateHorseNumber(horseNumber);
}

function winningSelectionsFromValidatedOrder(
  poolType: PoolType,
  finishOrder: readonly number[],
): readonly string[] {
  const [first, second, third] = finishOrder;
  if (first === undefined || second === undefined || third === undefined) {
    throw new DomainError('INVALID_SELECTION', 'Finish order is incomplete.');
  }
  if (poolType === 'place') {
    return [first, second, third].map((horse) =>
      selectionCodeFromValidatedHorses('place', [horse]),
    );
  }
  if (poolType === 'wide') {
    return [
      selectionCodeFromValidatedHorses('wide', [first, second]),
      selectionCodeFromValidatedHorses('wide', [first, third]),
      selectionCodeFromValidatedHorses('wide', [second, third]),
    ];
  }
  return [
    selectionCodeFromValidatedHorses(
      poolType,
      finishOrder.slice(0, POOL_TYPE_DEFINITIONS[poolType].selectionSize),
    ),
  ];
}

export function winSelection(horseNumber: number): string {
  return selectionCode('win', [horseNumber]);
}

export function trifectaSelection(first: number, second: number, third: number): string {
  return selectionCode('trifecta', [first, second, third]);
}

export function allTrifectaSelections(): readonly string[] {
  return allSelections('trifecta');
}

function validateHorseNumber(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new DomainError('INVALID_SELECTION', 'Horse number must be an integer from 1 to 8.');
  }
}
