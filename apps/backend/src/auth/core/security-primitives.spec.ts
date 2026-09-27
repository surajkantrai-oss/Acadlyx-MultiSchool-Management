import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AppConfigService } from '../../config/app-config.service.js';
import { afterFailure, LOCKOUT, validatePassword, validatePin } from './credential-policy.js';
import { KeysService } from './crypto/keys.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { normalizeHumanCode, recoveryCode } from './crypto/random.js';
import { AUDIENCES, TokenService } from './crypto/token.service.js';
import { totpCode, verifyTotp } from './crypto/totp.js';
import { identifierCandidates, normalizeEmail, normalizePhone } from './identifiers.js';

const edKey = () =>
  generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'der', type: 'pkcs8' })
    .toString('base64');

function config(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    AUTH_JWT_ISSUER: 'acadlyx',
    AUTH_JWT_PRIVATE_KEYS: { k1: edKey() },
    AUTH_JWT_ACTIVE_KID: 'k1',
    AUTH_ENCRYPTION_KEYS: { e1: randomBytes(32).toString('base64') },
    AUTH_ENCRYPTION_ACTIVE_KID: 'e1',
    AUTH_HMAC_KEYS: { h1: randomBytes(32).toString('base64') },
    AUTH_HMAC_ACTIVE_KID: 'h1',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as AppConfigService;
}

describe('TOTP (RFC 6238)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890"

  it('matches the RFC 6238 SHA-1 test vectors (6-digit truncation)', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('accepts ±1 step and rejects codes outside the window', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
  });
});

describe('KeysService', () => {
  it('encrypts with AES-256-GCM bound to its owner and detects tampering', () => {
    const keys = new KeysService(config());
    const box = keys.encrypt('JBSWY3DPEHPK3PXP', 'mfa:TENANT:u1');
    expect(box).not.toContain('JBSWY3DPEHPK3PXP');
    expect(keys.decrypt(box, 'mfa:TENANT:u1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => keys.decrypt(box, 'mfa:TENANT:u2')).toThrow(); // moved to another row
    const parts = box.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => keys.decrypt(parts.join(':'), 'mfa:TENANT:u1')).toThrow();
  });

  it('keeps decrypting/verifying with old keys after rotation', () => {
    const oldEnc = randomBytes(32).toString('base64');
    const oldHmac = randomBytes(32).toString('base64');
    const before = new KeysService(
      config({ AUTH_ENCRYPTION_KEYS: { e1: oldEnc }, AUTH_HMAC_KEYS: { h1: oldHmac } }),
    );
    const box = before.encrypt('secret', 'aad');
    const mac = before.hmac('123456');
    const after = new KeysService(
      config({
        AUTH_ENCRYPTION_KEYS: { e1: oldEnc, e2: randomBytes(32).toString('base64') },
        AUTH_ENCRYPTION_ACTIVE_KID: 'e2',
        AUTH_HMAC_KEYS: { h1: oldHmac, h2: randomBytes(32).toString('base64') },
        AUTH_HMAC_ACTIVE_KID: 'h2',
      }),
    );
    expect(after.decrypt(box, 'aad')).toBe('secret');
    expect(after.hmacMatches(mac, '123456')).toBe(true);
    expect(after.hmacMatches(mac, '123457')).toBe(false);
    expect(after.encrypt('x', 'aad').split(':')[1]).toBe('e2');
  });
});

describe('TokenService', () => {
  const cfg = config();
  const keys = new KeysService(cfg);
  const tokens = new TokenService(keys, cfg);
  const claims = { sub: 'u1', scope: 'TENANT' as const, sid: 's1', tid: 't1' };

  it('round-trips minimal claims and enforces audience', async () => {
    const { token } = await tokens.sign(AUDIENCES.tenantAccess, claims, 600);
    const ok = await tokens.verify(token, [AUDIENCES.tenantAccess]);
    expect(ok).toMatchObject({ ok: true, claims });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'scope',
      'sid',
      'sub',
      'tid',
    ]);
    expect(await tokens.verify(token, [AUDIENCES.platformAccess])).toEqual({
      ok: false,
      reason: 'wrong-audience',
    });
  });

  it('rejects modified payloads, foreign keys, expired and malformed tokens', async () => {
    const { token } = await tokens.sign(AUDIENCES.tenantAccess, claims, 600);
    const [h, , sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...claims,
        tid: 't2',
        aud: AUDIENCES.tenantAccess,
        iss: 'acadlyx',
        exp: 9e9,
      }),
    ).toString('base64url');
    expect(
      await tokens.verify(`${h ?? ''}.${forged}.${sig ?? ''}`, [AUDIENCES.tenantAccess]),
    ).toEqual({ ok: false, reason: 'invalid' });

    const foreign = new TokenService(new KeysService(config()), cfg); // same kid "k1", different key
    const { token: wrongKey } = await foreign.sign(AUDIENCES.tenantAccess, claims, 600);
    expect(await tokens.verify(wrongKey, [AUDIENCES.tenantAccess])).toEqual({
      ok: false,
      reason: 'invalid',
    });

    const expired = await new SignJWT({ scope: 'TENANT', sid: 's1' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject('u1')
      .setIssuer('acadlyx')
      .setAudience(AUDIENCES.tenantAccess)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(keys.jwtSigningKey());
    expect(await tokens.verify(expired, [AUDIENCES.tenantAccess])).toEqual({
      ok: false,
      reason: 'expired',
    });

    const noScope = await new SignJWT({ sid: 's1' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject('u1')
      .setIssuer('acadlyx')
      .setAudience(AUDIENCES.tenantAccess)
      .setExpirationTime('5m')
      .sign(keys.jwtSigningKey());
    expect(await tokens.verify(noScope, [AUDIENCES.tenantAccess])).toEqual({
      ok: false,
      reason: 'invalid',
    });

    for (const junk of ['', 'abc', 'a.b.c', `${h ?? ''}..`]) {
      expect(await tokens.verify(junk, [AUDIENCES.tenantAccess])).toMatchObject({ ok: false });
    }
  });
});

describe('PasswordHasher (Argon2id)', () => {
  it('never stores the raw secret, salts every hash and verifies correctly', async () => {
    const hasher = new PasswordHasher();
    const a = await hasher.hash('Correct-Horse-9');
    const b = await hasher.hash('Correct-Horse-9');
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toContain('Correct-Horse-9');
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, 'Correct-Horse-9')).toBe(true);
    expect(await hasher.verify(a, 'correct-horse-9')).toBe(false);
    expect(await hasher.verify('not-a-hash', 'x')).toBe(false);
    expect(hasher.needsRehash(a)).toBe(false);
    expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });
});

describe('credential policy', () => {
  it('validates PINs and passwords', () => {
    expect(() => {
      validatePin('482913');
    }).not.toThrow();
    for (const bad of ['12345', '1234567', 'abcdef', '111111', '123456', '654321', '345678']) {
      expect(() => {
        validatePin(bad);
      }, bad).toThrow();
    }
    expect(() => {
      validatePassword('short', 8);
    }).toThrow();
    expect(() => {
      validatePassword('long enough pw', 12);
    }).not.toThrow();
  });

  it('locks after the threshold and escalates the 3rd lockout within 24h (never permanent)', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    let state = {
      failedLoginCount: 0,
      lockoutCount: 0,
      lockoutWindowStartedAt: null as Date | null,
      lockedUntil: null as Date | null,
    };
    for (let i = 1; i < LOCKOUT.PIN.maxFailures; i += 1) {
      const next = afterFailure(state, 'PIN', now);
      expect(next.locked).toBe(false);
      state = next;
    }
    const first = afterFailure(state, 'PIN', now);
    expect(first).toMatchObject({ locked: true, failedLoginCount: 0, lockoutCount: 1 });
    expect(first.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60_000);
    const second = afterFailure({ ...first, failedLoginCount: 4 }, 'PIN', now);
    const third = afterFailure({ ...second, failedLoginCount: 4 }, 'PIN', now);
    expect(third.lockoutCount).toBe(3);
    expect(third.lockedUntil?.getTime()).toBe(now.getTime() + 24 * 3_600_000);
    const later = new Date(now.getTime() + 25 * 3_600_000);
    expect(afterFailure({ ...third, failedLoginCount: 4 }, 'PIN', later).lockoutCount).toBe(1); // window reset
    expect(afterFailure({ ...state, failedLoginCount: 9 }, 'PASSWORD', now).locked).toBe(true);
    expect(
      afterFailure({ ...state, failedLoginCount: 4 }, 'PLATFORM', now).lockedUntil?.getTime(),
    ).toBe(now.getTime() + 30 * 60_000);
  });
});

describe('identifiers', () => {
  it('normalises email, phone and login IDs', () => {
    expect(normalizeEmail(' Principal@School.COM ')).toBe('principal@school.com');
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('12')).toBeNull();
    expect(identifierCandidates('STU-001')).toEqual({
      loginId: 'STU-001',
      email: null,
      phone: null,
    });
    expect(identifierCandidates('a@b.co').email).toBe('a@b.co');
  });

  it('formats and normalises recovery codes', () => {
    const code = recoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(normalizeHumanCode(code.toLowerCase().replace('-', ' '))).toBe(code.replace('-', ''));
  });
});
