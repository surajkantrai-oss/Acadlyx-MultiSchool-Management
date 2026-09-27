import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service.js';

/**
 * Key rings for signing (Ed25519), encryption (AES-256-GCM) and HMAC. Each ring holds several
 * keys by id; new material uses the ACTIVE key id, older ids still verify/decrypt, so keys can
 * be rotated without downtime. Key material comes from validated environment configuration
 * (AWS Secrets Manager in the deployment phase) and is never logged.
 */
@Injectable()
export class KeysService {
  readonly jwtActiveKid: string;
  private readonly jwtPrivate = new Map<string, KeyObject>();
  private readonly jwtPublic = new Map<string, KeyObject>();
  private readonly encActiveKid: string;
  private readonly encKeys = new Map<string, Buffer>();
  private readonly hmacActiveKid: string;
  private readonly hmacKeys = new Map<string, Buffer>();

  constructor(config: AppConfigService) {
    for (const [kid, b64] of Object.entries(config.get('AUTH_JWT_PRIVATE_KEYS'))) {
      const key = createPrivateKey({
        key: Buffer.from(b64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new Error(`AUTH_JWT_PRIVATE_KEYS[${kid}] must be an Ed25519 key`);
      }
      this.jwtPrivate.set(kid, key);
      this.jwtPublic.set(kid, createPublicKey(key));
    }
    this.jwtActiveKid = config.get('AUTH_JWT_ACTIVE_KID');
    for (const [kid, b64] of Object.entries(config.get('AUTH_ENCRYPTION_KEYS'))) {
      this.encKeys.set(kid, Buffer.from(b64, 'base64'));
    }
    this.encActiveKid = config.get('AUTH_ENCRYPTION_ACTIVE_KID');
    for (const [kid, b64] of Object.entries(config.get('AUTH_HMAC_KEYS'))) {
      this.hmacKeys.set(kid, Buffer.from(b64, 'base64'));
    }
    this.hmacActiveKid = config.get('AUTH_HMAC_ACTIVE_KID');
  }

  jwtSigningKey(): KeyObject {
    const key = this.jwtPrivate.get(this.jwtActiveKid);
    if (!key) throw new Error('Active JWT key missing');
    return key;
  }

  jwtVerificationKey(kid: string | undefined): KeyObject | undefined {
    return kid === undefined ? undefined : this.jwtPublic.get(kid);
  }

  /** AES-256-GCM; `aad` binds ciphertext to its owner so it cannot be moved between rows. */
  encrypt(plaintext: string, aad: string): string {
    const key = this.encKeys.get(this.encActiveKid);
    if (!key) throw new Error('Active encryption key missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      this.encActiveKid,
      iv.toString('base64'),
      ciphertext.toString('base64'),
      cipher.getAuthTag().toString('base64'),
    ].join(':');
  }

  decrypt(payload: string, aad: string): string {
    const [version, kid, iv, ciphertext, tag] = payload.split(':');
    const key = kid === undefined ? undefined : this.encKeys.get(kid);
    if (version !== 'v1' || !key || !iv || !ciphertext || !tag) {
      throw new Error('Unreadable encrypted secret');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** `<kid>:<hex HMAC-SHA256>` with the active key. */
  hmac(value: string): string {
    return `${this.hmacActiveKid}:${this.hmacWith(this.hmacActiveKid, value)}`;
  }

  /** Constant-time comparison against a stored `<kid>:<hex>` using that key id. */
  hmacMatches(stored: string, value: string): boolean {
    const [kid, hex] = stored.split(':');
    if (!kid || !hex || !this.hmacKeys.has(kid)) return false;
    const expected = Buffer.from(hex, 'hex');
    const actual = Buffer.from(this.hmacWith(kid, value), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private hmacWith(kid: string, value: string): string {
    const key = this.hmacKeys.get(kid);
    if (!key) throw new Error('HMAC key missing');
    return createHmac('sha256', key).update(value).digest('hex');
  }
}
