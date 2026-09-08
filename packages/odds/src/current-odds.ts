import type { Money } from '@jcb/domain';

/**
 * Parimutuel odds for one selection, in tenths.
 *
 * `winningSelectionCount` is how many selections the pool pays out (three for
 * place and wide, one for every other pool). Such a pool is settled by splitting
 * its balance into that many equal sub-pools, so the payable share behind a
 * single selection is the pool total divided by that count.
 */
export function currentOddsTenths(
  seedLiquidity: Money,
  totalUserStake: Money,
  seedSelectionStake: Money,
  userSelectionStake: Money,
  winningSelectionCount = 1,
): bigint {
  if (!Number.isInteger(winningSelectionCount) || winningSelectionCount < 1) {
    throw new Error('Winning selection count must be a positive integer.');
  }
  const denominator = seedSelectionStake + userSelectionStake;
  if (denominator <= 0n) throw new Error('Selection stake must be positive.');
  const payableShare = (seedLiquidity + totalUserStake) / BigInt(winningSelectionCount);
  return (payableShare * 10n) / denominator;
}

export function formatOdds(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}`;
}

/**
 * The same quote for display paths, which must survive a selection nothing is
 * staked on. Betting close writes an odds snapshot for every selection of every
 * pool, so throwing there would strand the race instead of the one price.
 */
export function optionalCurrentOdds(
  seedLiquidity: Money,
  totalUserStake: Money,
  seedSelectionStake: Money,
  userSelectionStake: Money,
  winningSelectionCount = 1,
): string | undefined {
  if (seedSelectionStake + userSelectionStake <= 0n) return undefined;
  return formatOdds(
    currentOddsTenths(
      seedLiquidity,
      totalUserStake,
      seedSelectionStake,
      userSelectionStake,
      winningSelectionCount,
    ),
  );
}
