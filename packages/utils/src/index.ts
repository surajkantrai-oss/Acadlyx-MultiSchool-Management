/**
 * Joins a base URL and a path with exactly one slash between them.
 * `joinUrl('http://x/api/v1/', '/health')` -> `http://x/api/v1/health`
 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Exhaustiveness guard for discriminated unions. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
