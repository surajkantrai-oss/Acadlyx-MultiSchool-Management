/**
 * Tenant lifecycle (approved Phase 2 rule set).
 *
 *   DRAFT ──activate──▶ ACTIVE ◀──activate── SUSPENDED
 *     │                  │  │                   ▲ │
 *     │ archive   suspend│  └─────deactivate──┐ │ │deactivate
 *     ▼                  └──────────────────────┘ ▼
 *  ARCHIVED ◀──archive── INACTIVE ──activate──▶ ACTIVE
 *
 * ARCHIVED is terminal. Only ACTIVE tenants resolve on tenant-scoped routes.
 */
export const TENANT_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'ARCHIVED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'INACTIVE'],
  SUSPENDED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export const TENANT_LIFECYCLE_ACTIONS = {
  activate: 'ACTIVE',
  suspend: 'SUSPENDED',
  deactivate: 'INACTIVE',
  archive: 'ARCHIVED',
} as const satisfies Record<string, TenantStatus>;
export type TenantLifecycleAction = keyof typeof TENANT_LIFECYCLE_ACTIONS;

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TENANT_STATUS_TRANSITIONS[from].includes(to);
}

/** Lifecycle actions currently available for a tenant in `status`. */
export function availableActions(status: TenantStatus): TenantLifecycleAction[] {
  return (Object.keys(TENANT_LIFECYCLE_ACTIONS) as TenantLifecycleAction[]).filter((action) =>
    canTransition(status, TENANT_LIFECYCLE_ACTIONS[action]),
  );
}

/** Only ACTIVE tenants may serve tenant-scoped (school/mobile) traffic. */
export function isOperational(status: TenantStatus): boolean {
  return status === 'ACTIVE';
}
