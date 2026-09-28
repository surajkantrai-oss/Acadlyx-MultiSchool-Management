# School Admin portal (Phase 6)

Phase 6 turns the School Admin app into one operational workspace built on the Phase 4 (academic)
and Phase 5 (people) domain. It adds **no database tables and no migration**. Every view is a read
model composed from existing entities, in the tenant context (`TenantPrismaService` → FORCE RLS).

## Navigation

A shared `AppShell` provides:

- tenant branding (the Phase 2 `BrandedFrame`)
- a skip link
- header global search and sign out
- grouped side navigation

The navigation is built from **permissions only** (`lib/nav.ts`), never from role names:

| Group        | Link                | Visible with                  |
| ------------ | ------------------- | ----------------------------- |
| Overview     | Dashboard           | any signed-in user            |
| People       | Students            | `student.read`                |
|              | Parents / guardians | `parent.read`                 |
|              | Teachers            | `teacher.read`                |
|              | Login access        | `people_account.manage`       |
|              | Bulk import         | `bulk_import.read`            |
| Academics    | Classes             | `enrollment.read`             |
|              | Grades & sections   | `grade.read`                  |
|              | Subjects            | `subject.read`                |
| School setup | School profile      | `school.read`                 |
|              | Branches            | `branch.read`                 |
|              | Academic years      | `academic_year.read`          |
|              | Academic settings   | `academic_configuration.read` |
| Account      | Security & sessions | any signed-in user            |

Hiding a link is not authorisation. Every page re-checks its permission and shows "No access",
and every API route enforces its own permission; direct URLs are covered by tests.

## Academic context

The selector shows **Academic year** and **Branch**. There is no school selector, because V1 has
one school per tenant.

- **Defaults:** the school's current academic year, and **all branches** (approved decision B). If
  no current year exists, a warning links to Academic years; no arbitrary year is picked.
- **Persistence (approved decision C):** a browser-session cookie `acx_ctx` (HttpOnly, SameSite=Lax,
  ids only, no PII) set by a same-origin Server Action. The selection is also mirrored into the URL
  (`?year=…&branch=…`), so views are shareable and browser back/forward works.
- **Resolution order:** URL, then cookie, then defaults.
- **Validation:**
  - The UI accepts only ids that appear in the school's own year and branch lists; foreign or
    unknown ids are ignored.
  - The API re-validates any context id against the caller's school and returns
    `404 CONTEXT_NOT_FOUND` for foreign ids.
  - The context is a filter only. Tenant, school and permissions are always derived server-side.
- **Where it applies:** the Dashboard (enrollment and class counts, "not placed" check) and Classes.
  People lists stay school-wide by default, because people exist independently of placement; they
  keep their own URL filters (year, branch, grade, section, status, login, review).

## Dashboard

`GET /api/v1/workspace/dashboard?academicYearId&branchId` (`tenant.workspace.access`). Each block is
included only when the caller holds its permissions. A block the caller cannot read is **omitted,
never zeroed**.

| Block       | Requires                           | Content                                                                                            |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| students    | `student.read` + `people.read_all` | counts by status; active students enrolled in the context                                          |
| teachers    | `teacher.read`                     | counts by status                                                                                   |
| parents     | `parent.read` + `people.read_all`  | profiles, guardian links                                                                           |
| classes     | `section.read`                     | sections in the context (all / active)                                                             |
| accounts    | `people_account.manage`            | per profile type: no login, pending, active, suspended, disabled                                   |
| dataQuality | `student.read` + `people.read_all` | active students not placed (context year), with no guardian; active teachers with no current class |
| imports     | `bulk_import.read`                 | 5 most recent jobs (Phase 5 import service), pending count                                         |

- **Setup progress:** the Phase 4 setup status is shown as before.
- **Excluded:** no attendance, fees, results or homework cards (later phases).
- **Queries:** counts use `COUNT` and `GROUP BY` (no N+1, nothing loaded into memory to be counted).
- **Wording:** data-quality items are worded as situations ("No login", "not placed in a class"),
  not errors.

## Recent activity (decision E, confirmed 2026-09-28)

- **Source:** the existing `audit_logs` table only. There is no new table, event system, queue or
  duplicated audit row. The query runs in the tenant transaction, so FORCE RLS applies.
- **Permission:** `school_activity.read`, a new tenant permission held only by Principal and School
  Admin. Without it, the dashboard response has no `activity` key. The API enforces this, not just
  the UI.
- **Query:** one bounded SQL statement. It selects supported actions only, newest first, with a
  60-row candidate window, and excludes the per-row entries the bulk-import worker writes
  (`metadata.importJobId`). It returns at most **10** items.
- **School isolation:**
  - AuditLog has no school column. Each candidate is therefore resolved against the current
    school's own tables (about 8 batched id lookups) and dropped if its record isn't in this school.
  - This keeps a second school of the same tenant out, on top of tenant RLS.
  - Deleted records (for example an unlinked guardian) are resolved through the student they
    belonged to.
- **Safe output:**
  - Each item contains `{ key, at, message, subject, actorName, href }`.
  - `message` is fixed school-facing text.
  - `subject` and `actorName` are display names.
  - `key` is an opaque list key that is never shown.
  - No metadata, changed fields, IP addresses, user agents, ids as text, codes, secrets or
    before/after values are returned.

| Audit action                                                     | Shown as                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| STUDENT_CREATED                                                  | Student profile created                                                    |
| STUDENT_STATUS_CHANGED                                           | Student marked active / inactive / withdrawn / graduated                   |
| GUARDIAN_LINKED / GUARDIAN_UNLINKED                              | Guardian linked to student / Guardian unlinked from student                |
| ENROLLMENT_CREATED / ENROLLMENT_TRANSFERRED / ENROLLMENT_UPDATED | Student placed in a class / moved to another class / Class placement ended |
| PARENT_CREATED                                                   | Guardian profile created                                                   |
| TEACHER_CREATED                                                  | Teacher profile created                                                    |
| TEACHER_STATUS_CHANGED                                           | Teacher activated / Teacher deactivated                                    |
| TEACHER_ASSIGNMENT_CREATED / TEACHER_ASSIGNMENT_REMOVED          | Teacher assigned to a class / Teacher assignment ended                     |
| IMPORT_COMPLETED / IMPORT_FAILED                                 | Student/Guardian/Teacher import completed / Bulk import failed             |
| PROFILE_ACCOUNT_CREATED / PROFILE_ACCOUNT_LINKED                 | Login account created / linked                                             |
| ACTIVATION_CODE_ISSUED                                           | Account activation started                                                 |

Security, authentication, platform and configuration events are never selected. Profile edits
(`*_UPDATED` with changed fields) are excluded too, to avoid hinting at before/after data.

## Classes (section-based rosters)

A class **is a Section**; there is no `Class` table.

- `GET /api/v1/classes?academicYearId&branchId&gradeId` (`enrollment.read`) lists the sections of
  the context with active-student and open-assignment counts. Filtered `_count` relations keep this
  to one query.
- `GET /api/v1/classes/:sectionId` (`enrollment.read`) returns the class header and roster (≤ 500
  active enrollments): admission number, name, status, guardian count, primary guardian name (only
  with `parent.read`) and login state. It also returns:
  - teachers, with `teacher_assignment.read`
  - the grade's subjects, with `subject.read`
- The page reuses Phase 5 workflows:
  - Enroll a student: `POST /students/:id/enrollments`, same rules.
  - Assign a teacher: `POST /teachers/:id/assignments`; an inactive teacher is rejected.
  - Remove an assignment: soft end, with confirmation.
  - A transfer is done from the student's page.
- No attendance, fees or marks.

## Teacher data scope (approved decision A)

A new permission, `people.read_all`, is granted to Principal, School Admin, Admission Officer and
Accountant. Holders read every student, guardian, enrollment and roster of the school.

Everyone else who holds a people read permission (Teachers) sees **only sections they actively
teach**. That means an open assignment (`ended_at IS NULL`) on the section, held through their own
ACTIVE teacher profile. This is enforced at resource level by `people-scope.ts` in:

- student list and detail
- student enrollments
- parent list and detail (children outside the scope are hidden, child counts are scoped)
- class list and roster
- global search

Out-of-scope ids return 404. Ending the assignment removes access immediately. The school-wide
`GET /people/summary` now requires `people.read_all`.

## Global search

`GET /api/v1/workspace/search?q=` (`tenant.workspace.access`).

- **Types:** students (`student.read`), parents (`parent.read`), teachers (`teacher.read`), and
  classes in the current year (`section.read` + `enrollment.read`). The people data scope applies.
- **Bounds:** `q` is 2–64 characters (400 otherwise); at most 6 results per type.
- **Matching:** name and admission number / parent code / employee ID only. Contact fields are
  **not searchable** (they cannot be probed) and never returned: no phone, email or DOB.
- **UI:** an ARIA 1.2 combobox with a grouped listbox, 250 ms debounce, arrow/Enter/Escape keys and
  a polite live status.

## People workflows (polish over Phase 5)

- **Lists:** breadcrumbs, URL-state filters, and new filters for **Login** (no login / pending /
  active / suspended / disabled) and **Review** (students: not placed / no guardian; teachers: no
  current class). Empty states offer "add" and "import" where permitted.
- **Student page:**
  - Summary header: admission number, status, class, branch, year, login.
  - Sections: Profile, Status, Academic placement (enrollment history), Guardians (the accessible
    checkboxes from Phase 5 are unchanged), Login account, and Status history (from, to, reason,
    staff member, date).
  - Confirmation dialogs (native modal `<dialog>`, focus on Cancel) for status changes, completing
    an enrollment and unlinking a guardian.
- **Teacher and parent pages:** breadcrumbs, and confirmations for deactivation.

## Login access (approved decision D)

`/people/access` lists `GET /api/v1/workspace/access?kind&state&q&page` (`people_account.manage`):
profiles with no login or a non-active login. Rows link to the profile's **Login account** panel,
where the existing Phase 5 actions (create, link, activation) live. There is no duplicate identity
administration, no silent role grants and no default passwords. Platform Admin still owns tenant
identity administration.

## Errors and 404s

- An unknown school host shows "School not found" (404). A missing record or page inside a known
  school shows "Record not found" (404): the `people/` and `classes/` segment boundaries, plus a
  tenant-aware root boundary.
- API failures map to safe copy (`friendlyError`); raw backend text is never shown.

## Accessibility

The following are in place:

- skip link
- landmark navigation with `aria-current`
- labelled selects and checkboxes
- `aria-invalid` on fields
- table captions and scoped headers
- accessible pagination (`nav[aria-label=Pagination]`)
- live status regions (search, context changes, action notices)
- modal dialogs with focus management
- visible focus rings
- tables scroll horizontally on narrow screens, with sticky headers on large tables

## BFF

The Phase 5 allow-list gains two entries: `workspace/(dashboard|search|access)` and
`classes(/id)`. Everything else is unchanged: HttpOnly session cookies, CSRF header plus origin
check on mutations, and `no-store`.
