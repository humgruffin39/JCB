export interface RetryOptions {
  readonly delaysMs?: readonly number[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly isPermanent?: (error: unknown) => boolean;
}

export type RetryResult<T> =
  | { readonly kind: 'success'; readonly value: T; readonly attempts: number }
  | { readonly kind: 'permanent_failure'; readonly error: unknown; readonly attempts: number }
  | { readonly kind: 'exhausted'; readonly error: unknown; readonly attempts: number };

const defaultDelays = [1_000, 3_000, 10_000] as const;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const delays = options.delaysMs ?? defaultDelays;
  const sleep = options.sleep ?? defaultSleep;
  const isPermanent = options.isPermanent ?? (() => false);
  let attempts = 0;
  let lastError: unknown = new Error('Retry operation was not attempted');

  for (let attemptIndex = 0; attemptIndex <= delays.length; attemptIndex += 1) {
    if (attemptIndex > 0) {
      const delay = delays[attemptIndex - 1];
      if (delay !== undefined) {
        await sleep(delay);
      }
    }

    attempts += 1;
    try {
      return { kind: 'success', value: await operation(), attempts };
    } catch (error) {
      lastError = error;
      if (isPermanent(error)) {
        return { kind: 'permanent_failure', error, attempts };
      }
    }
  }

  return { kind: 'exhausted', error: lastError, attempts };
}

export async function retryOrThrow<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const result = await retry(operation, options);
  if (result.kind === 'success') {
    return result.value;
  }
  throw result.error;
}
