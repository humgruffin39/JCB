export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_RACE_TRANSITION'
  | 'INVALID_RACE_ENTRY'
  | 'INVALID_HORSE'
  | 'INVALID_SELECTION'
  | 'BETTING_CLOSED'
  | 'INSUFFICIENT_FUNDS'
  | 'RACE_BET_LIMIT_EXCEEDED'
  | 'DUPLICATE_OPERATION';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;

  public constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
