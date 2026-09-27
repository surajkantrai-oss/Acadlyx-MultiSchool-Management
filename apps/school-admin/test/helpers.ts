/**
 * TEST-ONLY helpers for School Admin e2e tests (running API + `next start`).
 * Fixtures are written directly with the platform/owner role (DATABASE_URL); cleanup hard-deletes
 * by key prefix. Never used by the application.
 */
import http from 'node:http';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import pg from 'pg';

export const SCHOOL_ADMIN_URL = new URL(process.env.SCHOOL_ADMIN_URL ?? 'http://127.0.0.1:4002');

export interface HttpResult {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
  setCookies: string[];
}

/** Request to School Admin with an explicit Host header (what a browser on that domain sends). */
export function request(
  method: string,
  path: string,
  opts: { host: string; headers?: Record<string, string>; body?: unknown },
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      new URL(path, SCHOOL_ADMIN_URL),
      {
        method,
        headers: {
          host: `${opts.host}:${SCHOOL_ADMIN_URL.port}`,
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] ?? [];
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8').replaceAll('<!-- -->', ''),
            headers: res.headers,
            setCookies: setCookie,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Cookie jar helpers. `next start` runs in production mode, so auth cookies carry the `__Host-`
 * prefix (+ Secure); dev uses bare names. Helpers accept both and echo the real name back.
 */
export const cookieLine = (setCookies: string[], name: string): string | undefined =>
  setCookies.find((c) => c.startsWith(`__Host-${name}=`) || c.startsWith(`${name}=`));
export function cookieValue(setCookies: string[], name: string): string | undefined {
  return cookieLine(setCookies, name)?.split(';')[0]?.split('=').slice(1).join('=');
}
export function cookieHeader(setCookies: string[], names: string[]): string {
  return names
    .map((n) => cookieLine(setCookies, n)?.split(';')[0])
    .filter((pair): pair is string => Boolean(pair) && !pair?.endsWith('='))
    .join('; ');
}

export function db(): pg.Client {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for fixtures');
  return new pg.Client({ connectionString: url });
}

export async function purge(client: pg.Client, prefix: string): Promise<void> {
  const like = `${prefix}\\_%`;
  const ids = (
    await client.query<{ id: string }>('SELECT id FROM tenants WHERE key LIKE $1', [like])
  ).rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const table of [
    'audit_logs',
    'platform_audit_logs',
    'otp_challenges',
    'refresh_tokens',
    'sessions',
    'user_devices',
    'mfa_recovery_codes',
    'mfa_methods',
    'user_roles',
    'users',
    'tenant_configurations',
    'tenant_features',
    'tenant_brandings',
    'tenant_domains',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
}

export async function createSchool(
  client: pg.Client,
  input: {
    key: string;
    status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'ARCHIVED';
    domain: string;
    name: string;
    color?: string;
  },
): Promise<string> {
  const slug = input.key.toLowerCase().replace(/_/g, '-');
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO tenants (id, key, slug, display_name, status, first_activated_at, archived_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::tenant_status, CASE WHEN $4::tenant_status <> 'DRAFT' THEN now() END, CASE WHEN $4::tenant_status = 'ARCHIVED' THEN now() END, now())
     RETURNING id`,
    [input.key, slug, input.name, input.status],
  );
  const id = rows[0]?.id ?? '';
  await client.query(
    "INSERT INTO tenant_domains (id, tenant_id, domain, type, is_primary, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ADMIN', true, now())",
    [id, input.domain],
  );
  await client.query(
    'INSERT INTO tenant_brandings (id, tenant_id, school_name, primary_color, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now())',
    [id, input.name, input.color ?? '#1D4ED8'],
  );
  return id;
}

export async function createUser(
  client: pg.Client,
  input: { tenantId: string; name: string; email: string; password: string; role: string },
): Promise<string> {
  const hash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (id, tenant_id, display_name, email, status, credential_type, credential_hash, credential_updated_at, email_verified_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', 'PASSWORD', $4, now(), now(), now()) RETURNING id`,
    [input.tenantId, input.name, input.email, hash],
  );
  const id = rows[0]?.id ?? '';
  await client.query(
    "INSERT INTO user_roles (id, tenant_id, user_id, role_id, role_scope) SELECT gen_random_uuid(), $1, $2, id, 'TENANT' FROM roles WHERE key = $3",
    [input.tenantId, id, input.role],
  );
  return id;
}

/** Clears API rate-limit counters (all BFF traffic shares one source IP in tests). */
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
