import type { TenantStatus } from '@acadlyx/tenant-config';
import { Badge } from '@acadlyx/web-ui';
import { STATUS_TONE } from '@/lib/status';

export function StatusBadge({ status }: { status: TenantStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
