declare const identifierBrand: unique symbol;

export type Identifier<Tag extends string> = string & {
  readonly [identifierBrand]: Tag;
};

export type AccountId = Identifier<'AccountId'>;
export type BetId = Identifier<'BetId'>;
export type HorseId = Identifier<'HorseId'>;
export type JobId = Identifier<'JobId'>;
export type LedgerTransactionId = Identifier<'LedgerTransactionId'>;
export type RaceId = Identifier<'RaceId'>;
export type UserId = Identifier<'UserId'>;

export function identifier<Tag extends string>(value: string): Identifier<Tag> {
  if (value.length === 0) {
    throw new Error('Identifier must not be empty.');
  }
  return value as Identifier<Tag>;
}
