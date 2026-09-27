/**
 * Login identifier normalisation (approved policy).
 *   email    → trimmed, lower-cased
 *   phone    → E.164; a bare 10-digit (or 0-prefixed 11-digit) number is treated as Indian (+91)
 *   login ID → student admission / staff employee ID, trimmed, case preserved (exact match)
 * Tenant login lookup precedence is deterministic: login ID, then email, then phone.
 */
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, '');
  let e164: string;
  if (compact.startsWith('+')) e164 = compact;
  else if (/^\d{10}$/.test(compact)) e164 = `+91${compact}`;
  else if (/^0\d{10}$/.test(compact)) e164 = `+91${compact.slice(1)}`;
  else if (/^91\d{10}$/.test(compact)) e164 = `+${compact}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function normalizeLoginId(value: string): string | null {
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(id) ? id : null;
}

export interface IdentifierCandidates {
  loginId: string | null;
  email: string | null;
  phone: string | null;
}

/** All interpretations of a free-text login identifier. */
export function identifierCandidates(raw: string): IdentifierCandidates {
  return {
    loginId: normalizeLoginId(raw),
    email: raw.includes('@') ? normalizeEmail(raw) : null,
    phone: raw.includes('@') ? null : normalizePhone(raw),
  };
}
