import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from './logging.module.js';

describe('log redaction', () => {
  it('never writes credentials, codes or tokens to logs', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    const secrets = {
      password: 'pw-SECRET-1',
      pin: '482913',
      secret: 'pw-SECRET-2',
      currentSecret: 'pw-SECRET-3',
      newSecret: 'pw-SECRET-4',
      code: '771234',
      recoveryCode: 'ABCDE-FGHJK',
      refreshToken: 'rt-SECRET',
      accessToken: 'at-SECRET',
      mfaToken: 'mfa-SECRET',
      grantToken: 'grant-SECRET',
      credentialHash: '$argon2id$SECRET',
      secretEncrypted: 'v1:SECRET',
      installationId: 'install-SECRET',
      otp: '993311',
      mfaSecret: 'JBSWY3DPSECRET',
      privateKey: 'MC4CAQAwBQYDK2VwBCIEIPRIVATE',
      AUTH_JWT_PRIVATE_KEYS: '{"k1":"PRIVATE-KEY-RING"}',
      AUTH_ENCRYPTION_KEYS: '{"e1":"ENC-KEY-RING"}',
      AUTH_HMAC_KEYS: '{"h1":"HMAC-KEY-RING"}',
    };
    logger.info(
      {
        body: secrets,
        req: { headers: { authorization: 'Bearer at-SECRET', cookie: 'acx_rt=rt-SECRET' } },
      },
      'auth event',
    );
    const output = lines.join('');
    for (const value of [...Object.values(secrets), 'Bearer at-SECRET', 'acx_rt=rt-SECRET']) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain('[REDACTED]');
  });
});
