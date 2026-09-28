# RBAC (Phases 3–6)

Source of truth: `packages/permissions/src/index.ts`. At startup the backend syncs the registry
into `roles`, `permissions` and `role_permissions`. The sync runs under a PostgreSQL advisory
lock, so concurrent instances are safe. **Authorisation checks permissions, never role names.**
Permissions are resolved server-side on every request and are never placed in the JWT.

## Permissions

| Key                                       | Scope    | Meaning                                       |
| ----------------------------------------- | -------- | --------------------------------------------- |
| `platform.tenant.read`                    | PLATFORM | View schools and their configuration          |
| `platform.tenant.manage`                  | PLATFORM | Create and configure schools                  |
| `platform.tenant_user.read`               | PLATFORM | View school user accounts                     |
| `platform.tenant_user.manage`             | PLATFORM | Create school users, manage roles and status  |
| `tenant.workspace.access`                 | TENANT   | Open the authenticated school workspace       |
| `tenant.settings.read`                    | TENANT   | View the school's features and settings       |
| `school.read` / `school.manage`           | TENANT   | View / edit the school profile (Phase 4)      |
| `branch.read` / `branch.manage`           | TENANT   | View / manage branches, primary branch        |
| `academic_year.read` / `.manage`          | TENANT   | View / manage academic years and current year |
| `grade.read` / `grade.manage`             | TENANT   | View / manage and reorder grades              |
| `section.read` / `section.manage`         | TENANT   | View / manage and reorder sections            |
| `subject.read` / `subject.manage`         | TENANT   | View / manage subjects and grade mappings     |
| `academic_configuration.read` / `.manage` | TENANT   | View / edit academic settings                 |
| `student.read` / `student.manage`         | TENANT   | Student profiles, status, guardians (Phase 5) |
| `parent.read` / `parent.manage`           | TENANT   | Parent profiles and contact details           |
| `teacher.read` / `teacher.manage`         | TENANT   | Teacher profiles and status                   |
| `enrollment.read` / `enrollment.manage`   | TENANT   | Class placement, transfer, end enrollment     |
| `teacher_assignment.read` / `.manage`     | TENANT   | Subject / class-teacher assignments           |
| `bulk_import.read` / `bulk_import.manage` | TENANT   | Import jobs (also needs `<type>.manage`)      |
| `people_account.manage`                   | TENANT   | Create / link login accounts for profiles     |
| `people.read_all`                         | TENANT   | School-wide people reads (Phase 6 data scope) |
| `school_activity.read`                    | TENANT   | Dashboard recent-activity feed (Phase 6)      |

## Roles (system roles; no custom roles yet)

"Structure read" = `school.read`, `branch.read`, `academic_year.read`, `grade.read`,
`section.read` (Phase 4).

| Role              | Scope    | Permissions                                                     | MFA      | PIN | Session policy |
| ----------------- | -------- | --------------------------------------------------------------- | -------- | --- | -------------- |
| PLATFORM_ADMIN    | PLATFORM | all four `platform.*`                                           | required | no  | PLATFORM       |
| PRINCIPAL         | TENANT   | workspace.access, settings.read, **all 14 Phase 4** permissions | required | no  | PRIVILEGED     |
| SCHOOL_ADMIN      | TENANT   | workspace.access, settings.read, **all 14 Phase 4** permissions | required | no  | PRIVILEGED     |
| ACCOUNTANT        | TENANT   | workspace.access, structure read                                | required | no  | PRIVILEGED     |
| TEACHER           | TENANT   | workspace.access, structure read, `subject.read`                | optional | no  | STAFF          |
| ADMISSION_OFFICER | TENANT   | workspace.access, structure read                                | optional | no  | STAFF          |
| TRANSPORT_MANAGER | TENANT   | workspace.access, `school.read`, `branch.read`                  | optional | no  | STAFF          |
| PARENT            | TENANT   | workspace.access                                                | optional | yes | FAMILY         |
| STUDENT           | TENANT   | workspace.access                                                | optional | yes | FAMILY         |

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

## Phase 4 grants — rationale

Only Principal and School Admin manage the academic structure. Staff get the read access later
modules need (accountants for fee structures by grade/section, admission officers for class
allocation, teachers also for subjects), and no role other than leadership can read or change
academic settings. Parents and students have no access to school-configuration APIs.
Platform permissions are never granted to tenant roles (tested in `@acadlyx/permissions`).

## Phase 5 grants — rationale

| Role              | Phase 5 permissions                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| PRINCIPAL         | all 13                                                                                                           |
| SCHOOL_ADMIN      | all 13                                                                                                           |
| ADMISSION_OFFICER | student, parent and enrollment read + manage; bulk_import read + manage (no teacher manage → no Teachers import) |
| TEACHER           | student, parent, teacher, enrollment and teacher_assignment read                                                 |
| ACCOUNTANT        | student.read, enrollment.read                                                                                    |
| TRANSPORT_MANAGER | none (Phase 5)                                                                                                   |
| PARENT, STUDENT   | none: family self-service views come in a later phase                                                            |

`people_account.manage` is leadership-only, because it creates login identities. Guardian contact
details in a student response are shown only to callers holding `parent.read`.

## Phase 6 — people data scope

`people.read_all` is a **data-scope** permission. It is granted to Principal, School Admin,
Admission Officer and Accountant; Teachers do not have it.

Without it, holders of `student.read`, `parent.read` or `enrollment.read` see only students (and
those students' guardians, enrollments and class rosters) in sections where they hold an open
assignment through their own ACTIVE teacher profile. This is enforced at resource level in the
services, not in the UI, and is covered by e2e tests and a negative control. A teacher who is also
a parent gains nothing school-wide from the parent role.

Navigation visibility is derived from permissions (`apps/school-admin/src/lib/nav.ts`) and is never
authorisation on its own.

### Accountant and `people.read_all` (reviewed 2026-09-28)

Accountant keeps `people.read_all`. The Master Blueprint is not in this repository, so the
decision rests on the approved Phase 5 grant: Accountant has `student.read` and `enrollment.read`
(fee structures by grade/section, see "Phase 4 grants"), and in Phase 5 those were school-wide.

Without `people.read_all`, an Accountant (who teaches nothing) would see **no** students, which
would silently revoke approved access. Keeping it restores exactly the Phase 5 view and nothing
more:

- Accountant has no `parent.read`, so no guardian profiles or contact details.
- Class rosters hide guardian names.
- There are no management permissions.
- `school_activity.read` is not granted to Accountant.

### `school_activity.read`

Granted only to Principal and School Admin. It gates the humanised AuditLog feed on the dashboard
(the API omits the block otherwise).
