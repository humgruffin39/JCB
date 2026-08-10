import type { Money } from '@jcb/domain';

export function currentOddsTenths(
  seedLiquidity: Money,
  totalUserStake: Money,
  seedSelectionStake: Money,
  userSelectionStake: Money,
): bigint {
  const denominator = seedSelectionStake + userSelectionStake;
  if (denominator <= 0n) throw new Error('Selection stake must be positive.');
  return ((seedLiquidity + totalUserStake) * 10n) / denominator;
}

export function formatOdds(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}`;
}
