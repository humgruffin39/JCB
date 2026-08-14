function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const value = (error as { status?: unknown }).status;
  return typeof value === 'number' ? value : undefined;
}

export function isPermanentDiscordError(error: unknown): boolean {
  const code = errorCode(error);
  const status = errorStatus(error);
  const permanentCodes = new Set<string | number>([
    10_007,
    10_008,
    50_001,
    50_013,
    50_035,
    'UnknownMember',
    'MissingAccess',
    'MissingPermissions',
  ]);
  return (
    permanentCodes.has(code ?? '') ||
    (status !== undefined && status >= 400 && status < 500 && status !== 429)
  );
}
