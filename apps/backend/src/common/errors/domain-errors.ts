import { TENANT_ERROR_CODES } from '@acadlyx/tenant-config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Domain errors carry a stable `code` which AllExceptionsFilter copies into the standard
 * ApiErrorResponse. Messages are safe for clients: no internal ids, SQL or policy names.
 */
export const tenantNotFound = () =>
  new NotFoundException({ code: TENANT_ERROR_CODES.NOT_FOUND, message: 'Tenant not found' });

export const tenantUnavailable = () =>
  new ForbiddenException({
    code: TENANT_ERROR_CODES.UNAVAILABLE,
    message: 'This school is not currently available',
  });

export const tenantConflict = () =>
  new BadRequestException({
    code: TENANT_ERROR_CODES.CONFLICT,
    message: 'Request identifies more than one tenant',
  });

export const conflict = (code: string, message: string) => new ConflictException({ code, message });

export const notFound = (code: string, message: string) => new NotFoundException({ code, message });

export const badRequest = (code: string, message: string | string[]) =>
  new BadRequestException({ code, message });

/**
 * Prisma unique-constraint violation (P2002), optionally on one named unique index,
 * e.g. `tenants_slug_key`. Matches exact names only — Prisma 7 driver adapters report the
 * violated index in meta.driverAdapterError.cause.constraint.index.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code !== 'P2002') return false;
  if (constraint === undefined) return true;
  return violatedConstraints(meta).includes(constraint);
}

function violatedConstraints(meta: unknown): string[] {
  const names: string[] = [];
  const cause = (meta as { driverAdapterError?: { cause?: { constraint?: unknown } } } | undefined)
    ?.driverAdapterError?.cause?.constraint;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'index' in cause &&
    typeof cause.index === 'string'
  ) {
    names.push(cause.index);
  }
  return names;
}
