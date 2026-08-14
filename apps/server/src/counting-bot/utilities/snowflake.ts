const snowflakePattern = /^[1-9][0-9]{0,20}$/;

export function assertSnowflake(value: string, fieldName = 'snowflake'): void {
  if (!snowflakePattern.test(value)) {
    throw new Error(`${fieldName} is not a valid Discord snowflake`);
  }
}

export function compareSnowflakes(left: string, right: string): number {
  assertSnowflake(left);
  assertSnowflake(right);
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function sortBySnowflake<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareSnowflakes(left.id, right.id));
}
