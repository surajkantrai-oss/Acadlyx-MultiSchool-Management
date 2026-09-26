import type { TenantStatus } from '@acadlyx/tenant-config';
import type { BadgeTone } from '@acadlyx/web-ui';

export const STATUS_TONE: Record<TenantStatus, BadgeTone> = {
  DRAFT: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  INACTIVE: 'neutral',
  ARCHIVED: 'danger',
};

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
