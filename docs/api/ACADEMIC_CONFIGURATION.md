# Academic configuration API (Phase 4)

These are tenant-scoped routes under `/api/v1`:

- The tenant comes from `Host` (web) or `X-Acadlyx-Tenant-Key` (mobile), **never** from the
  body or query.
- Every route requires a TENANT session bound to that tenant and the listed permission.
- Ids are UUIDs (anything else returns `400`). Ids of other tenants return `404`.
- Responses are `Cache-Control: no-store`. Errors use the standard shape (`statusCode`,
  `error`, `code`, `message`, `requestId`, `timestamp`, `path`).

| Method & path                                      | Permission                      | Notes                                                             |
| -------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `GET /school`                                      | `school.read`                   | School profile                                                    |
| `PATCH /school`                                    | `school.manage`                 | `boardName` only with `board=OTHER`; the code is upper-cased      |
| `GET /school/setup-status`                         | `school.read`                   | Real counts + checklist                                           |
| `GET /school/academic-settings`                    | `academic_configuration.read`   | timezone, weekStartDay, workingDays, academicYearStartMonth       |
| `PATCH /school/academic-settings`                  | `academic_configuration.manage` | IANA timezone; ≥ 1 unique working day                             |
| `GET /branches?q=&active=`                         | `branch.read`                   | Primary first, then name                                          |
| `POST /branches`                                   | `branch.manage`                 | The first branch becomes primary; timezone defaults from settings |
| `GET/PATCH /branches/:id`                          | read / manage                   |                                                                   |
| `POST /branches/:id/activate` · `/deactivate`      | `branch.manage`                 | Primary cannot be deactivated (`PRIMARY_BRANCH_REQUIRED`)         |
| `POST /branches/:id/set-primary`                   | `branch.manage`                 | Atomic switch; branch must be active                              |
| `GET /academic-years`                              | `academic_year.read`            | `start_date` DESC                                                 |
| `POST /academic-years`                             | `academic_year.manage`          | `{name, startDate, endDate}` (`YYYY-MM-DD`), created PLANNED      |
| `GET/PATCH /academic-years/:id`                    | read / manage                   | Dates only while PLANNED (`ACADEMIC_YEAR_DATES_LOCKED`)           |
| `POST /academic-years/:id/activate` · `/close`     | `academic_year.manage`          | PLANNED→ACTIVE→CLOSED; the current year cannot close              |
| `POST /academic-years/:id/set-current`             | `academic_year.manage`          | ACTIVE only; atomic                                               |
| `GET /grades`                                      | `grade.read`                    | By `display_order`                                                |
| `POST /grades` · `GET/PATCH /grades/:id`           | read / manage                   |                                                                   |
| `POST /grades/:id/activate` · `/deactivate`        | `grade.manage`                  |                                                                   |
| `PUT /grades/order` `{ids}`                        | `grade.manage`                  | Complete list, each id exactly once (`REORDER_MISMATCH`)          |
| `GET /grades/:id/subjects`                         | `subject.read`                  | Grade–subject mappings                                            |
| `PUT /grades/:id/subjects/:subjectId`              | `subject.manage`                | Assign or update `{isRequired}`                                   |
| `DELETE /grades/:id/subjects/:subjectId`           | `subject.manage`                | Remove the mapping                                                |
| `GET /sections?branchId=&academicYearId=&gradeId=` | `section.read`                  | Grade order, then section order                                   |
| `POST /sections`                                   | `section.manage`                | `{branchId, academicYearId, gradeId, name, code, capacity?}`      |
| `GET/PATCH /sections/:id`                          | read / manage                   | name, code, capacity only (scope immutable)                       |
| `POST /sections/:id/activate` · `/deactivate`      | `section.manage`                |                                                                   |
| `PUT /sections/order`                              | `section.manage`                | `{branchId, academicYearId, gradeId, ids}`                        |
| `GET /subjects?q=&active=`                         | `subject.read`                  | By name                                                           |
| `POST /subjects` · `GET/PATCH /subjects/:id`       | read / manage                   |                                                                   |
| `POST /subjects/:id/activate` · `/deactivate`      | `subject.manage`                |                                                                   |

There are **no hard-delete endpoints** except for removing a grade–subject mapping.

## Error codes

- **Not found (404):** `SCHOOL_NOT_FOUND`, `BRANCH_NOT_FOUND`, `ACADEMIC_YEAR_NOT_FOUND`,
  `GRADE_NOT_FOUND`, `SECTION_NOT_FOUND`, `SUBJECT_NOT_FOUND`, `GRADE_SUBJECT_NOT_FOUND`.
- **Duplicates (409):** `DUPLICATE_SCHOOL_CODE`, `DUPLICATE_BRANCH_CODE`,
  `DUPLICATE_ACADEMIC_YEAR_NAME`, `DUPLICATE_GRADE_CODE`, `DUPLICATE_SECTION_CODE`,
  `DUPLICATE_SUBJECT_CODE`.
- **Rule violations (409):** `ACADEMIC_YEAR_OVERLAP`, `PRIMARY_BRANCH_REQUIRED`,
  `BRANCH_INACTIVE`, `GRADE_INACTIVE`, `SUBJECT_INACTIVE`, `ACADEMIC_YEAR_TRANSITION_INVALID`,
  `ACADEMIC_YEAR_NOT_ACTIVE`, `ACADEMIC_YEAR_DATES_LOCKED`, `ACADEMIC_YEAR_CLOSED`,
  `CURRENT_ACADEMIC_YEAR_CANNOT_CLOSE`.
- **Bad requests (400):** `ACADEMIC_YEAR_DATES_INVALID`, `REORDER_MISMATCH`,
  `BOARD_NAME_ONLY_FOR_OTHER`.

Database constraint names are never returned.

## Clients

- **Typed client:** `createApiClient(...).academic.*` in `@acadlyx/api-client`.
- **School Admin:** calls the API through its BFF (`/bff/api/<path>`, HttpOnly cookie, CSRF
  header, explicit allow-list).
- **Platform tokens** are rejected on these routes. There is no support or impersonation
  access in Phase 4.
