/** Canonical serialization for the version-1 object-only publication envelope. */
export function canonicalPublication(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalPublication(object[key])).join(',') + '}';
}
