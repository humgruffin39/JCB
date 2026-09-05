/**
 * Deterministic JSON for values that are signed on one runtime and verified on
 * another.
 *
 * Keys are ordered by code unit rather than by `localeCompare`, whose result
 * depends on the runtime's locale data. The server signs release manifests on
 * Node and the edge worker verifies them on workerd, so the two must agree on
 * byte-for-byte output or every manifest fails verification.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
