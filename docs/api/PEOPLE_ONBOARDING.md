# People & onboarding API (Phase 5)

All routes are tenant-scoped (`/api/v1/…`, resolved by host), require a tenant session, and declare a
permission. Errors use `ApiErrorResponse` with safe codes: no SQL, constraint names or stack traces.
Lists take `page`, `pageSize` (≤ 100) and `q`, plus the filters shown.

## Students — `student.read` / `student.manage`

| Method | Path                                               | Permission        | Notes                                                                                              |
| ------ | -------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/students`                                        | student.read      | filters `status`, `academicYearId`, `gradeId`, `sectionId`, `branchId`, `q`                        |
| POST   | `/students`                                        | student.manage    | optional `enrollment` and `guardians` in the same transaction                                      |
| GET    | `/students/:id`                                    | student.read      | guardian contact only if the caller has `parent.read`                                              |
| PATCH  | `/students/:id`                                    | student.manage    |                                                                                                    |
| POST   | `/students/:id/status`                             | student.manage    | `{status, reason?}`; allowed transitions only (`STUDENT_STATUS_TRANSITION_INVALID`)                |
| POST   | `/students/:id/guardians`                          | student.manage    | `{parentId, relationship, isPrimary?, pickupAuthorized?, isEmergencyContact?}`                     |
| PATCH  | `/students/:id/guardians/:linkId`                  | student.manage    |                                                                                                    |
| DELETE | `/students/:id/guardians/:linkId`                  | student.manage    |                                                                                                    |
| GET    | `/students/:id/enrollments`                        | enrollment.read   |                                                                                                    |
| POST   | `/students/:id/enrollments`                        | enrollment.manage | `{sectionId, startDate?}`; `ACTIVE_ENROLLMENT_EXISTS`, `SECTION_UNAVAILABLE`, `STUDENT_NOT_ACTIVE` |
| POST   | `/students/:id/enrollments/:enrollmentId/transfer` | enrollment.manage | `{sectionId, date?}`, same academic year                                                           |
| POST   | `/students/:id/enrollments/:enrollmentId/end`      | enrollment.manage | `{status: WITHDRAWN\|COMPLETED, date?}`                                                            |

## Parents — `parent.read` / `parent.manage`

`GET/POST /parents`, `GET/PATCH /parents/:id`, `POST /parents/:id/activate` and `POST /parents/:id/deactivate`.
Email is normalised to lower case and phone to E.164 using the Phase 3 rules. `parent_code` is
optional, unique within the school, and upper-cased.

## Teachers — `teacher.read` / `teacher.manage`, `teacher_assignment.*`

`GET/POST /teachers`, `GET/PATCH /teachers/:id`, `POST /teachers/:id/status`,
`GET /teachers/:id/assignments` (read), `POST /teachers/:id/assignments`
(`{type, sectionId, subjectId?}`), and `POST /teachers/:id/assignments/:assignmentId/end`.

## Accounts — `people_account.manage`

For `students`, `parents` and `teachers`:

- `POST /:kind/:id/account` creates a PENDING_ACTIVATION user with the matching role and starts
  activation. Response: `{account, activation}`. If the profile has an email or phone, activation
  is the normal OTP flow. Otherwise a one-time admin-issued code is returned once and never stored
  in plain text.
- `POST /:kind/:id/account/link` with `{userId}` links an existing same-tenant user that already holds the role.
  Errors: `ROLE_REQUIRED`, `PROFILE_ALREADY_LINKED`, `USER_ALREADY_LINKED`, 404 otherwise.
- `POST /:kind/:id/account/activation-code` re-issues activation for a pending account.

All account actions are audited (`PROFILE_ACCOUNT_CREATED`, `PROFILE_ACCOUNT_LINKED`,
`ACTIVATION_CODE_ISSUED`).

## Imports — `bulk_import.read` / `bulk_import.manage`

| Method | Path                            | Notes                                                                                            |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/imports/templates/:type`      | Column spec (JSON)                                                                               |
| GET    | `/imports/templates/:type/file` | `?format=csv\|xlsx`; header row + one fictional example row                                      |
| POST   | `/imports`                      | multipart `type` + `file` (≤ 5 MB, ≤ 5,000 rows) → READY job with preview counts                 |
| GET    | `/imports`, `/imports/:id`      | Jobs and progress                                                                                |
| GET    | `/imports/:id/rows`             | `?status=` filter, paginated                                                                     |
| GET    | `/imports/:id/errors.csv`       | Per-row error report; cells are neutralised against formula injection                            |
| POST   | `/imports/:id/confirm`          | READY → QUEUED (enqueued); `503 IMPORT_QUEUE_UNAVAILABLE` if Redis is down (the job stays READY) |
| POST   | `/imports/:id/cancel`           | READY → CANCELLED; stored row data is cleared                                                    |

The import type also requires `<type>.manage`. For example, an Admission Officer cannot run a
Teachers import.

## Summary

`GET /people/summary` returns school-wide counts. Since Phase 6 it requires `people.read_all`.

## Phase 6 changes

- **Teacher data scope:** without `people.read_all`, student, parent and enrollment reads are
  limited to sections the caller actively teaches, and out-of-scope ids return 404.
- **New list filters:**
  - `account=NONE|PENDING_ACTIVATION|ACTIVE|SUSPENDED|DISABLED` on students, parents and teachers
  - `quality=NO_ENROLLMENT|NO_GUARDIAN` on students (with an optional `academicYearId`)
  - `quality=NO_ASSIGNMENT` on teachers
- **Status history:** each entry includes `actorName`.
- **Workspace endpoints:** see [../architecture/SCHOOL_ADMIN_PORTAL.md](../architecture/SCHOOL_ADMIN_PORTAL.md).

## School Admin BFF

The School Admin app proxies these routes through `/bff/api/…` using an explicit allow-list.
Mutations need `x-acadlyx-csrf` and a same-origin `Origin`. Multipart uploads are forwarded
byte-for-byte, and bodies over 5 MB + 64 KB are rejected with 413 before they reach the API.
Binary downloads (templates, error reports) pass through with their `content-disposition`.
