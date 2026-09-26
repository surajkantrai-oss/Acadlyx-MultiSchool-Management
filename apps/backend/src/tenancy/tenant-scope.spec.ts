import { describe, expect, it } from 'vitest';
import { scopeQueryArgs, TenantScopeViolationError } from './tenant-scope.js';

const A = '0190a0a0-0000-7000-8000-00000000000a';
const B = '0190a0a0-0000-7000-8000-00000000000b';

describe('scopeQueryArgs', () => {
  it('injects the current tenant into reads, updates and deletes', () => {
    expect(scopeQueryArgs('TenantFeature', 'findMany', {}, A)).toEqual({ where: { tenantId: A } });
    expect(
      scopeQueryArgs(
        'TenantConfiguration',
        'update',
        { where: { id: 'x' }, data: { value: 1 } },
        A,
      ),
    ).toEqual({ where: { id: 'x', tenantId: A }, data: { value: 1 } });
    expect(scopeQueryArgs('TenantDomain', 'deleteMany', { where: { id: 'x' } }, A)).toEqual({
      where: { id: 'x', tenantId: A },
    });
    expect(scopeQueryArgs('Tenant', 'findFirst', undefined, A)).toEqual({ where: { id: A } });
  });

  it('stamps the current tenant onto created rows', () => {
    expect(scopeQueryArgs('TenantFeature', 'create', { data: { featureKey: 'FEES' } }, A)).toEqual({
      data: { featureKey: 'FEES', tenantId: A },
    });
    expect(
      scopeQueryArgs('TenantFeature', 'createMany', { data: [{ featureKey: 'X' }] }, A).data,
    ).toEqual([{ featureKey: 'X', tenantId: A }]);
  });

  it('rejects explicit attempts to target another tenant', () => {
    expect(() =>
      scopeQueryArgs('TenantFeature', 'findMany', { where: { tenantId: B } }, A),
    ).toThrow(TenantScopeViolationError);
    expect(() =>
      scopeQueryArgs('TenantFeature', 'create', { data: { tenantId: B, featureKey: 'X' } }, A),
    ).toThrow(TenantScopeViolationError);
    expect(() => scopeQueryArgs('Tenant', 'findUnique', { where: { id: B } }, A)).toThrow(
      TenantScopeViolationError,
    );
  });

  it('fails closed for unregistered models and tenant creation', () => {
    expect(() => scopeQueryArgs('SomethingNew', 'findMany', {}, A)).toThrow(/not registered/);
    expect(() => scopeQueryArgs(undefined, 'queryRaw', {}, A)).toThrow(/not registered/);
    expect(() => scopeQueryArgs('Tenant', 'create', { data: {} }, A)).toThrow(/cannot be created/);
  });
});
