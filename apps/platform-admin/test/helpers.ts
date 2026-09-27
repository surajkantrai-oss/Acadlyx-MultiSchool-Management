/**
 * TEST-ONLY helpers for Platform Admin e2e tests (running API + `next start` on :4001).
 * Platform users are inserted directly with the owner role; cleanup hard-deletes by email prefix.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import pg from 'pg';

export const PLATFORM_ADMIN_URL = new URL(
  process.env.PLATFORM_ADMIN_URL ?? 'http://localhost:4001',
);
export const ORIGIN = PLATFORM_ADMIN_URL.origin;

export interface HttpResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  setCookies: string[];
}

export function request(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      new URL(path, PLATFORM_ADMIN_URL),
      {
        method,
        headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8').replaceAll('<!-- -->', ''),
            headers: res.headers,
            setCookies: res.headers['set-cookie'] ?? [],
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Cookie helpers: `next start` is production mode (`__Host-` prefix + Secure). */
export const cookieLine = (setCookies: string[], name: string): string | undefined =>
  setCookies.find((c) => c.startsWith(`__Host-${name}=`) || c.startsWith(`${name}=`));
export const cookieValue = (setCookies: string[], name: string): string | undefined =>
  cookieLine(setCookies, name)?.split(';')[0]?.split('=').slice(1).join('=');

/** A minimal cookie jar that applies Set-Cookie updates (including deletions). */
export class Jar {
  private readonly cookies = new Map<string, string>();
  apply(setCookies: string[]): void {
    for (const line of setCookies) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(only?: string[]): string {
    return [...this.cookies]
      .filter(([n]) => !only || only.some((o) => n === o || n === `__Host-${o}`))
      .map(([n, v]) => `${n}=${v}`)
      .join('; ');
  }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — mirrors what an authenticator app computes. */
export function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function db(): pg.Client {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for fixtures');
  return new pg.Client({ connectionString: url });
}

export async function purgePlatformUsers(client: pg.Client, emailPrefix: string): Promise<void> {
  const ids = (
    await client.query<{ id: string }>('SELECT id FROM platform_users WHERE email LIKE $1', [
      `${emailPrefix}%`,
    ])
  ).rows.map((r) => r.id);
  if (ids.length === 0) return;
  await client.query(
    'DELETE FROM platform_audit_logs WHERE actor_platform_user_id = ANY($1::uuid[])',
    [ids],
  );
  for (const table of [
    'sessions',
    'user_devices',
    'mfa_recovery_codes',
    'mfa_methods',
    'platform_user_roles',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE platform_user_id = ANY($1::uuid[])`, [ids]);
  }
  await client.query('DELETE FROM platform_users WHERE id = ANY($1::uuid[])', [ids]);
}

export async function createPlatformAdmin(
  client: pg.Client,
  email: string,
  password: string,
): Promise<string> {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO platform_users (id, email, display_name, status, password_hash, credential_updated_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'E2E Platform Admin', 'ACTIVE', $2, now(), now()) RETURNING id`,
    [email, hash],
  );
  const id = rows[0]?.id ?? '';
  await client.query(
    "INSERT INTO platform_user_roles (platform_user_id, role_id, role_scope) SELECT $1, id, 'PLATFORM' FROM roles WHERE key = 'PLATFORM_ADMIN'",
    [id],
  );
  return id;
}

export async function resetRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', {
    lazyConnect: true,
  });
  await redis.connect();
  try {
    for (const pattern of ['auth:ident:*', 'throttle:*']) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    }
  } finally {
    redis.disconnect();
  }
}
