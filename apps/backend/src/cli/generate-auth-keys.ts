/**
 * Prints fresh authentication key material as .env lines (development / first setup).
 *
 *   pnpm --filter @acadlyx/backend auth:keys
 *
 * Output goes to stdout only; paste into apps/backend/.env (never commit it). For rotation, add
 * a new key id to the JSON map, switch *_ACTIVE_KID, and remove the old id after all tokens /
 * ciphertexts using it have expired or been re-encrypted.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const { privateKey } = generateKeyPairSync('ed25519');
const jwtKid = `jwt${stamp}`;
const encKid = `enc${stamp}`;
const hmacKid = `hmac${stamp}`;

const lines = [
  `AUTH_JWT_PRIVATE_KEYS=${JSON.stringify({ [jwtKid]: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') })}`,
  `AUTH_JWT_ACTIVE_KID=${jwtKid}`,
  `AUTH_ENCRYPTION_KEYS=${JSON.stringify({ [encKid]: randomBytes(32).toString('base64') })}`,
  `AUTH_ENCRYPTION_ACTIVE_KID=${encKid}`,
  `AUTH_HMAC_KEYS=${JSON.stringify({ [hmacKid]: randomBytes(32).toString('base64') })}`,
  `AUTH_HMAC_ACTIVE_KID=${hmacKid}`,
];
process.stdout.write(`${lines.join('\n')}\n`);
