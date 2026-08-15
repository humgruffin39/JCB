import { DomainError, money, type Money } from '@jcb/domain';

export interface AllocationClaim {
  readonly id: string;
  readonly weight: Money;
  readonly tieBreaker: string;
}

export interface Allocation {
  readonly id: string;
  readonly amount: Money;
}

interface RankedRemainder {
  readonly id: string;
  readonly floor: bigint;
  readonly remainderNumerator: bigint;
  readonly tieBreaker: string;
}

export function allocateProRata(
  total: Money,
  claims: readonly AllocationClaim[],
): readonly Allocation[] {
  if (total < 0n) {
    throw new DomainError('INVALID_MONEY', 'Allocation total cannot be negative.');
  }
  if (claims.length === 0) {
    if (total === 0n) return [];
    throw new DomainError('INVALID_MONEY', 'A positive total requires at least one claim.');
  }
  if (new Set(claims.map((claim) => claim.id)).size !== claims.length) {
    throw new DomainError('INVALID_MONEY', 'Allocation claim IDs must be unique.');
  }
  const totalWeight = claims.reduce((sum, claim) => sum + claim.weight, 0n);
  if (totalWeight <= 0n || claims.some((claim) => claim.weight < 0n)) {
    throw new DomainError(
      'INVALID_MONEY',
      'Allocation weights must be non-negative with a positive sum.',
    );
  }

  const ranked: RankedRemainder[] = claims.map((claim) => {
    const numerator = total * claim.weight;
    return {
      id: claim.id,
      floor: numerator / totalWeight,
      remainderNumerator: numerator % totalWeight,
      tieBreaker: claim.tieBreaker,
    };
  });
  let remaining = total - ranked.reduce((sum, claim) => sum + claim.floor, 0n);
  ranked.sort(
    (left, right) =>
      compareBigIntDescending(left.remainderNumerator, right.remainderNumerator) ||
      left.tieBreaker.localeCompare(right.tieBreaker) ||
      left.id.localeCompare(right.id),
  );
  const extras = new Set<string>();
  for (const claim of ranked) {
    if (remaining === 0n) break;
    extras.add(claim.id);
    remaining -= 1n;
  }
  return ranked
    .map((claim) => ({
      id: claim.id,
      amount: money(claim.floor + (extras.has(claim.id) ? 1n : 0n)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}
