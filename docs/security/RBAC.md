# RBAC (Phase 3)

Source of truth: `packages/permissions/src/index.ts`. At startup the backend syncs the registry
into `roles`, `permissions` and `role_permissions`. The sync runs under a PostgreSQL advisory
lock, so concurrent instances are safe. **Authorisation checks permissions, never role names.**
Permissions are resolved server-side on every request and are never placed in the JWT.

## Permissions

| Key                           | Scope    | Meaning                                      |
| ----------------------------- | -------- | -------------------------------------------- |
| `platform.tenant.read`        | PLATFORM | View schools and their configuration         |
| `platform.tenant.manage`      | PLATFORM | Create and configure schools                 |
| `platform.tenant_user.read`   | PLATFORM | View school user accounts                    |
| `platform.tenant_user.manage` | PLATFORM | Create school users, manage roles and status |
| `tenant.workspace.access`     | TENANT   | Open the authenticated school workspace      |
| `tenant.settings.read`        | TENANT   | View the school's features and settings      |

## Roles (system roles; no custom roles in Phase 3)

| Role              | Scope    | Permissions                     | MFA      | PIN | Session policy |
| ----------------- | -------- | ------------------------------- | -------- | --- | -------------- |
| PLATFORM_ADMIN    | PLATFORM | all four `platform.*`           | required | no  | PLATFORM       |
| PRINCIPAL         | TENANT   | workspace.access, settings.read | required | no  | PRIVILEGED     |
| SCHOOL_ADMIN      | TENANT   | workspace.access, settings.read | required | no  | PRIVILEGED     |
| ACCOUNTANT        | TENANT   | workspace.access                | required | no  | PRIVILEGED     |
| TEACHER           | TENANT   | workspace.access                | optional | no  | STAFF          |
| ADMISSION_OFFICER | TENANT   | workspace.access                | optional | no  | STAFF          |
| TRANSPORT_MANAGER | TENANT   | workspace.access                | optional | no  | STAFF          |
| PARENT            | TENANT   | workspace.access                | optional | yes | FAMILY         |
| STUDENT           | TENANT   | workspace.access                | optional | yes | FAMILY         |

A user may hold several roles (for example TEACHER + PARENT). The effective permissions are the
union of the roles' permissions. The **most restrictive** policy wins for MFA (required if any
role requires it), PIN (allowed only if every role allows it) and the session lifetime.

## Enforcement

- Routes declare policy with decorators: `@Public()`, `@Authenticated('TENANT' | 'PLATFORM')` or
  `@RequirePermission('…')` (implies the permission's scope), plus `@TenantScoped()` for routes
  that need a resolved school. The global `AccessGuard` rejects any route without a policy
  (fail closed).
- Scope confusion is rejected. A platform token on tenant routes (or the reverse) fails
  audience/scope checks. A tenant token for school A presented to school B → `403 TENANT_MISMATCH`.
- Role assignment validates scope: only TENANT roles can be assigned to tenant users. Role
  scope is also enforced in the database (CHECK plus composite FKs).
- **Assigning** a role revokes the user's sessions, because the new role may tighten MFA or
  session policy and the next login applies it. **Removing** a role invalidates the cached grants,
  so permissions shrink on the very next request; the last remaining role cannot be removed.
  Suspending or disabling a user revokes all of their sessions.

## Feature flags vs permissions

These are independent. Future module routes will require **both** the tenant feature enabled
(tenant-config) **and** the permission.

## Adding permissions (later phases)

Add to `PERMISSION_REGISTRY`, grant in `ROLE_REGISTRY`, and protect the route with
`@RequirePermission('…')`. Startup sync persists the change. Never check role keys in handlers.
