# People & enrollment model (Phase 5)

Phase 5 adds school-owned **profiles** for students, parents and teachers, the links between
them, class placement, teaching assignments and bulk onboarding. Profiles are business records.
They are deliberately separate from login identities (`users`, Phase 3).

## Tables

| Table                    | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `students`               | Student profile: admission number (school-unique), names, DOB, admission date, status |
| `student_status_history` | Append-only lifecycle trail (from → to, reason, actor)                                |
| `parents`                | Parent/guardian profile: optional school-unique `parent_code`, contact, active flag   |
| `student_guardians`      | Student ⇄ parent link: relationship, primary, pickup-authorized, emergency contact    |
| `teachers`               | Teacher profile: employee ID (school-unique), contact, joining date, status           |
| `student_enrollments`    | Placement of a student in a section for an academic year                              |
| `teacher_assignments`    | Subject-teacher or class-teacher assignment to a section                              |
| `bulk_import_jobs`       | One CSV/XLSX upload: type, template version, file hash, state, counters               |
| `bulk_import_rows`       | Normalised row data + per-row validation/processing outcome                           |

Every table carries `tenant_id` and `school_id`, has ENABLE + FORCE RLS with the
`tenant_isolation` policy, and references its parents through composite
`(…_id, school_id, tenant_id)` foreign keys (ON DELETE RESTRICT). A link can therefore never cross a
tenant **or** a school of the same tenant, even through buggy code or raw SQL.

## Profiles vs accounts

- A profile may exist without a login (`user_id` NULL). Most students and many parents never sign in.
- `user_id` references `users (id, tenant_id)`: a profile can link only a user of the same tenant.
  `UNIQUE (user_id, tenant_id)` means one profile of each kind per user. A user can still be both a
  teacher and a parent, with one teacher profile and one parent profile.
- Student personal data stays on `students`. Nothing is added to `users`.
- **Create account** (`people_account.manage`) creates a tenant user in `PENDING_ACTIVATION` with
  exactly the matching role (STUDENT/PARENT/TEACHER), links it, and starts the Phase 3 activation
  flow. No default password or PIN exists. The insert goes through the SECURITY DEFINER function
  `app_create_profile_account`. It requires tenant context, accepts only those three roles, and
  is the only way `acadlyx_app` can create a user row, because the role has no raw INSERT on `users`.
- **Link existing account** is allowed only if that user already holds the matching role;
  otherwise the result is `ROLE_REQUIRED`. Roles are never granted silently. Imports never create accounts.

## Student lifecycle

```
ACTIVE ⇄ INACTIVE
ACTIVE | INACTIVE → WITHDRAWN | GRADUATED
WITHDRAWN → ACTIVE          (re-admission)
GRADUATED                   (terminal)
```

Every change writes `student_status_history`. WITHDRAWN and GRADUATED end the student's ACTIVE
enrollments: WITHDRAWN sets them to WITHDRAWN, GRADUATED sets them to COMPLETED, and `end_date`
is set to today. Teachers have ACTIVE/INACTIVE only. An inactive teacher cannot receive new
assignments, and the status never touches the linked user.

## Guardians

At most one primary guardian per student (partial unique index `student_guardians_one_primary`).
Making another link primary demotes the previous one in the same transaction. Relationship is one
of FATHER, MOTHER, GUARDIAN, GRANDPARENT, SIBLING, OTHER. Unlinking deletes the link row; this is
the only Phase 5 table with DELETE granted.

## Enrollment

- Each enrollment references a section and a denormalised `academic_year_id`. The composite FK
  `(section_id, academic_year_id, school_id, tenant_id)` → `sections` keeps the two consistent.
- Status ACTIVE / TRANSFERRED / WITHDRAWN / COMPLETED. The partial unique index allows at most
  one ACTIVE enrollment per student per year. CHECK constraints ensure that an ACTIVE row has no
  `end_date` and that a closed row has one.
- A transfer runs atomically: the old row becomes TRANSFERRED with an end date, and a new ACTIVE
  row is created. Rows are never deleted, so history is preserved.
- No enrollment into inactive sections or sections of a CLOSED academic year.

## Teacher assignments

- `SUBJECT_TEACHER` requires a subject that is mapped to the section's grade (GradeSubject).
  Co-teaching is allowed, but the same teacher/section/subject cannot be active twice.
- `CLASS_TEACHER` has no subject, and a section has at most one active class teacher.
- Removal is a soft end (`ended_at`); the row stays for history.

## Bulk import

See [../development/BULK_IMPORT.md](../development/BULK_IMPORT.md). In brief: upload → parse and
validate everything → preview (nothing created) → confirm → BullMQ worker processes the valid rows in
the tenant context.

## Defence layers

1. `@RequirePermission` on every route (fails closed).
2. TenantContext + `TenantPrismaService` (restricted `acadlyx_app`, automatic scoping).
3. FORCE RLS on all 9 tables.
4. Composite FKs (tenant and school), CHECK constraints, partial unique indexes, column-level grants
   (scope and identity columns are immutable, and the status history is append-only).

The negative controls in Phase 5 disable layer 2 (RLS still isolates) and bypass the service
identity checks (the DB FK still refuses a cross-tenant user).
