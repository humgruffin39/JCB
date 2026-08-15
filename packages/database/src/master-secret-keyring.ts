export function normalizeMasterSecrets(value: string | readonly string[]): readonly string[] {
  const secrets = typeof value === 'string' ? [value] : [...value];
  if (secrets.length === 0 || secrets.some((secret) => secret.length === 0)) {
    throw new Error('At least one result master secret is required.');
  }
  return [...new Set(secrets)];
}
