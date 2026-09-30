/**
 * Phase 8 mobile validation, shared by the backend (authoritative) and the mobile app.
 * Assignment submissions are text and/or ONE https link (decision L). No files.
 */
import { z } from 'zod';

export const SUBMISSION_TEXT_MAX = 5000;
export const SUBMISSION_URL_MAX = 2048;

/**
 * Accepts only absolute `https://` URLs with a host and no whitespace/control characters.
 * `http:`, `javascript:`, `data:`, `file:`, `ftp:` and everything else are rejected. The URL is
 * stored as user-supplied text; it is never fetched, previewed or followed server-side.
 */
export function isHttpsUrl(value: string): boolean {
  if (value.length > SUBMISSION_URL_MAX) return false;
  // No whitespace and no control characters (code points < 0x20 or 0x7f).
  if (
    !/^https:\/\/[^\s]+$/i.test(value) ||
    Array.from({ length: value.length }, (_, i) => value.charCodeAt(i)).some(
      (c) => c < 32 || c === 127,
    )
  )
    return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Submission form. Text is kept as typed except that an all-whitespace text counts as empty
 * (meaningful content is never altered); the link is trimmed. At least one must remain.
 */
export const submissionSchema = z
  .object({
    text: z
      .string()
      .max(SUBMISSION_TEXT_MAX, `At most ${String(SUBMISSION_TEXT_MAX)} characters`)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v)),
    url: z
      .string()
      .trim()
      .max(SUBMISSION_URL_MAX, `At most ${String(SUBMISSION_URL_MAX)} characters`)
      .optional()
      .nullable()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v))
      .refine((v) => v === null || isHttpsUrl(v), {
        message: 'Enter a full link starting with https://',
      }),
  })
  .refine((v) => v.text !== null || v.url !== null, {
    message: 'Add your answer or a link',
    path: ['text'],
  });

export type SubmissionInput = z.input<typeof submissionSchema>;

/** Roles that have a Phase 8 mobile experience (UX selection only — never authorization). */
export const MOBILE_ROLES = ['PARENT', 'STUDENT', 'TEACHER'] as const;
export type MobileRoleKey = (typeof MOBILE_ROLES)[number];

/**
 * The active role after bootstrap: the remembered one if the server still grants it, else the
 * first available (Teacher, Parent, Student order); null when the user has no mobile role.
 */
export function resolveActiveRole(
  available: readonly MobileRoleKey[],
  remembered: string | null,
): MobileRoleKey | null {
  if (remembered && (available as readonly string[]).includes(remembered))
    return remembered as MobileRoleKey;
  for (const role of ['TEACHER', 'PARENT', 'STUDENT'] as const)
    if (available.includes(role)) return role;
  return null;
}

/** The selected child after bootstrap: the remembered one if still linked, else the first. */
export function resolveSelectedChild<T extends { studentId: string }>(
  children: readonly T[],
  remembered: string | null,
): T | null {
  return children.find((c) => c.studentId === remembered) ?? children[0] ?? null;
}
