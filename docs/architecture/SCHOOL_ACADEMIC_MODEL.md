# School & academic model (Phase 4)

This model follows the blueprint hierarchy (§11.3: Tenant → School → Branch → AcademicYear →
Grade → Section → Subject). The scoping decisions below were approved on 2026-09-27.

```
Tenant (SaaS customer: domains, features, white-label branding, subscription)
  └─ School (academic institution; V1 exactly one per tenant)
       ├─ Branch (campus)                    ─┐
       ├─ AcademicYear (dated period)         ├─→ Section (grade @ branch @ year)
       ├─ Grade (permanent class catalogue)  ─┘
       ├─ Subject (catalogue)
       └─ GradeSubject (grade offers subject; required/optional)
```

## Tenant vs School

| Tenant (Phase 2)                                            | School (Phase 4)                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Customer / isolation boundary (`tenant_id`, RLS)            | Academic institution owned by a tenant                           |
| Domains, features, lifecycle (access), white-label branding | Name, code, board, contact and address, academic settings        |
| Managed by Platform Admin                                   | Managed by the school's Principal / School Admin in School Admin |

- The tenant lifecycle stays authoritative for access. A School has **no separate status**.
- Branding (logo, colours, images) is **not** duplicated on School; it stays on `TenantBranding`.
- **Provisioning:** creating a tenant creates its School in the same transaction, audited as
  `SCHOOL_PROVISIONED`. The Phase 4 migration backfilled one School for every existing tenant.
  The tenant role cannot INSERT schools. The schema allows several schools per tenant (all
  FKs carry `school_id`); V1 resolves "the" school as the tenant's oldest one.

## Branch

- A branch is a campus with an explicit IANA `timezone`, never inferred from the server. New
  branches default to the school's timezone setting.
- **Primary:** exactly one per school once any branch exists. The first branch becomes primary.
  The switch is atomic (unset then set, under a school row lock). A partial unique index allows
  at most one primary, and a CHECK requires the primary to be active. The primary branch cannot
  be deactivated.
- Branches are never deleted (the tenant role has no DELETE); they are deactivated instead.

## AcademicYear

- Stores real `start_date` / `end_date` values (`DATE`, no time zone). April–March is not
  assumed; `academic_year_start_month` is only a form default.
- **Lifecycle:** `PLANNED → ACTIVE → CLOSED`, one-way. Only an ACTIVE year can be **current**,
  and at most one per school (partial unique index plus CHECK). Switching the current year is
  atomic. The current year cannot be closed.
- **No overlap** between the date ranges of one school. The service checks this under the
  school lock, backed by `EXCLUDE USING gist (school_id WITH =, daterange(start, end, '[]') WITH &&)`
  (`btree_gist`).
- **Locking:** dates can change only while PLANNED. Later phases attach enrollments, attendance,
  exams and fees to a year, so an active year's dates are frozen. Years are never deleted.

## Grade

- A permanent school-wide catalogue (Nursery, LKG, Grade 1 …), **not** versioned per year. Later,
  enrollment ties a student to a grade and section for a year.
- `display_order` is explicit (never alphabetical) and unique per school through a
  **DEFERRABLE** constraint, so a reorder can permute values in one transaction.
- The code is unique per school. Grades are deactivated, not deleted.

## Section

- **Scope = (branch, academic year, grade).** For example, Grade 5 · A at Main Campus in 2026–27.
  Sections can therefore differ per campus and per year.
- Composite FKs `(branch_id | academic_year_id | grade_id, school_id, tenant_id)` guarantee that
  all three parents belong to the same school **and** tenant. The scope columns are not
  updatable.
- The code is unique within the scope. Display order is unique within the scope (deferrable).
  `capacity` is optional (> 0 when set).
- New sections require an active branch and grade and a year that is not CLOSED.

## Subject and GradeSubject

- Subjects form a catalogue per school (code unique per school) and are deactivated, not
  deleted.
- `grade_subjects` maps a subject to a grade with `is_required` and `display_order`. A subject can
  belong to many grades, so there is no `grade_id` on Subject. A mapping is configuration, not
  history, so it may be removed (the only DELETE grant). Assigning requires an active grade and
  subject.

## Academic settings (school level)

The settings are typed columns on `schools`, not a JSON bag:

- `timezone`: the default for new branches
- `week_start_day`
- `working_days`: any set of weekdays; Sunday is **not** assumed to be off
- `academic_year_start_month`

The tenant-wide `TenantConfiguration` (locale, platform defaults) is unchanged. It supplies the
initial values when a School is provisioned. Branch-specific behaviour (timezone) lives on
`branches`.

## Security layers (unchanged architecture)

Authentication → RBAC (permission per route) → TenantContext (Host / tenant key) →
`TenantPrismaService` (`acadlyx_app`, scoping extension) → **FORCE RLS** (`tenant_isolation` on
all 7 tables) → composite FKs and CHECKs.

- Tenant academic services never import `PlatformPrismaService`. This is enforced by an ESLint
  rule, and the tenant module cannot even inject it.
- Structural mutations lock the school row (`SELECT … FOR UPDATE`), so concurrent requests
  queue instead of racing. The tests fire 12 concurrent primary/current switches and parallel
  creates.
- Other tenants' ids return a generic `404` with no data, and cross-tenant links are rejected by
  the composite FKs.

## Future relationships (Phase 5+)

Designed so that later modules reference stable ids:

- `StudentEnrollment` → (student, academic_year, grade, section, branch). The section already
  pins the branch, year and grade.
- `TeacherAssignment`, `Timetable`, `Homework`, `ExamSubject` → subject, section and year.
- `Attendance` → section and branch (with its timezone).

Because deactivation, not deletion, is the rule, historical records stay valid.
