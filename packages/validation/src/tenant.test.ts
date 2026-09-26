import { describe, expect, it } from 'vitest';
import {
  createTenantSchema,
  domainSchema,
  hexColorSchema,
  tenantBrandingSchema,
  tenantKeySchema,
  tenantSlugSchema,
} from './tenant.js';

describe('tenant identifiers', () => {
  it('accepts normalised keys and slugs', () => {
    expect(tenantKeySchema.safeParse('WORLD_WAY').success).toBe(true);
    expect(tenantSlugSchema.safeParse('world-way').success).toBe(true);
  });

  it('rejects malformed keys and slugs', () => {
    for (const key of ['world_way', '1ABC', 'A', 'WORLD-WAY', 'A'.repeat(41)]) {
      expect(tenantKeySchema.safeParse(key).success, key).toBe(false);
    }
    for (const slug of ['World-Way', '-world', 'world-', 'world--way', 'w', 'world_way']) {
      expect(tenantSlugSchema.safeParse(slug).success, slug).toBe(false);
    }
  });

  it('defaults new tenants to DRAFT', () => {
    const parsed = createTenantSchema.parse({ displayName: 'A', key: 'AB', slug: 'ab' });
    expect(parsed.initialStatus).toBe('DRAFT');
  });
});

describe('domainSchema', () => {
  it('normalises case and trailing dot', () => {
    expect(domainSchema.parse('Portal.WorldWaySchool.com.')).toBe('portal.worldwayschool.com');
    expect(domainSchema.parse('school-a.localhost')).toBe('school-a.localhost');
  });

  it.each([
    'https://portal.worldwayschool.com',
    'portal.worldwayschool.com/login',
    'WORLDWAY .com',
    'portal.worldwayschool.com:443',
    'localhost',
    '-bad.example.com',
    'a..b.com',
    '127.0.0.1',
  ])('rejects %s', (value) => {
    expect(domainSchema.safeParse(value).success).toBe(false);
  });
});

describe('tenantBrandingSchema', () => {
  const base = { schoolName: 'School A', primaryColor: '#1D4ED8' };

  it('accepts a minimal valid branding', () => {
    expect(tenantBrandingSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unsafe or malformed values', () => {
    expect(hexColorSchema.safeParse('blue').success).toBe(false);
    expect(hexColorSchema.safeParse('#fff').success).toBe(false);
    expect(
      tenantBrandingSchema.safeParse({ ...base, logoUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(tenantBrandingSchema.safeParse({ ...base, logoUrl: 'http://x.com/a.png' }).success).toBe(
      false,
    );
    expect(
      tenantBrandingSchema.safeParse({ ...base, footerText: '<script>x</script>' }).success,
    ).toBe(false);
    expect(tenantBrandingSchema.safeParse({ ...base, supportEmail: 'nope' }).success).toBe(false);
  });
});
