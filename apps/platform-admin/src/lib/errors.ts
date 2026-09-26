import { ApiError } from '@acadlyx/api-client';
import type { z } from '@acadlyx/validation';

export type FieldErrors = Partial<Record<string, string>>;

/** First message per field from a zod result (client-side validation). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Human-readable message for any failure from the API (server validation is authoritative). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.messages.join(' · ');
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
