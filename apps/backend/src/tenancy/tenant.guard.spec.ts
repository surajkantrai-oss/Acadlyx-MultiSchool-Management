import { TENANT_STATUSES } from '@acadlyx/tenant-config';
import { describe, expect, it } from 'vitest';
import { TenantContext, type TenantResolution } from './tenant-context.js';
import { hostToDomain } from './tenant-resolver.service.js';
import { TenantGuard } from './tenant.guard.js';

const guard = new TenantGuard();
const resolved = (status: (typeof TENANT_STATUSES)[number]): TenantResolution => ({
  outcome: 'resolved',
  source: 'host',
  tenant: { id: 'id', key: 'KEY', slug: 'slug', status },
});

function statusOf(resolution: TenantResolution | undefined): number {
  const run = () => guard.canActivate();
  try {
    if (resolution) TenantContext.run(resolution, run);
    else run();
    return 200;
  } catch (error) {
    return (error as { getStatus: () => number }).getStatus();
  }
}

describe('TenantGuard', () => {
  it('allows only ACTIVE tenants', () => {
    for (const status of TENANT_STATUSES) {
      expect(statusOf(resolved(status)), status).toBe(status === 'ACTIVE' ? 200 : 403);
    }
  });

  it('maps resolution failures to 404 / 400 and fails closed without middleware', () => {
    expect(statusOf({ outcome: 'not-found' })).toBe(404);
    expect(statusOf({ outcome: 'conflict' })).toBe(400);
    expect(statusOf(undefined)).toBe(500);
  });
});

describe('hostToDomain', () => {
  it('strips ports and normalises case', () => {
    expect(hostToDomain('School-A.localhost:4002')).toBe('school-a.localhost');
    expect(hostToDomain('portal.worldwayschool.com')).toBe('portal.worldwayschool.com');
  });

  it('ignores hosts that are not tenant domains', () => {
    for (const host of [
      undefined,
      '',
      'localhost:4000',
      '127.0.0.1:4000',
      '[::1]:4000',
      'bad host.com',
    ]) {
      expect(hostToDomain(host), String(host)).toBeUndefined();
    }
  });
});
