import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUID version 7 (48-bit Unix ms timestamp + random), matching the ids Prisma generates
 * with `@default(uuid(7))`. Used where rows are created outside Prisma's client (e.g. the
 * `app_create_profile_account` database function) so ids stay time-ordered and v7-shaped.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
