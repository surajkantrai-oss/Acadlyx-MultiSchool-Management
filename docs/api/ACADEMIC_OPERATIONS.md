# Academic operations API (Phase 7)

All routes are tenant-scoped (`/api/v1/…`, school resolved from the host) and require a tenant
session plus the named permission. Teachers are additionally limited to the sections and subjects
they are assigned (other ids return **404**). Errors use `ApiErrorResponse` with stable codes;
no SQL or constraint names are ever returned. Dates are school-local `YYYY-MM-DD`; times are
local `HH:MM`.

## Attendance

| Method | Path                                                   | Permission        | Notes                                                                                                                |
| ------ | ------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/attendance/classes?academicYearId&branchId`          | attendance.read   | Classes in scope with `markedToday`, `studentCount`                                                                  |
| GET    | `/attendance/sections/:sectionId?date=`                | attendance.read   | Sheet: roster for the date, statuses, `session.version`, `editable`, `lockedReason`                                  |
| PUT    | `/attendance`                                          | attendance.manage | `{sectionId, date, expectedVersion?, records[{studentId, status, note?}]}` — records (first save) or corrects        |
| GET    | `/attendance/sections/:sectionId/history?page&from&to` | attendance.read   | Recorded days with counts (paginated)                                                                                |
| GET    | `/attendance/sections/:sectionId/changes?date=`        | attendance.read   | Correction log (append-only history)                                                                                 |
| GET    | `/attendance/students/:studentId?academicYearId`       | attendance.read   | Student summary: counts + `attendanceRate` = (P+L)/(P+L+A), EXCUSED/unmarked excluded, 1 dp, `null` if none eligible |

Save errors:

- `ATTENDANCE_FUTURE_DATE`, `ATTENDANCE_OUTSIDE_WINDOW` (teachers, more than 7 school-local calendar days back),
  `ACADEMIC_YEAR_NOT_ACTIVE`, `DATE_OUTSIDE_ACADEMIC_YEAR`, `SECTION_UNAVAILABLE`.
- `STUDENT_NOT_ON_ROSTER`, `DUPLICATE_STUDENT`.
- `409 ATTENDANCE_STALE` / `STALE_VERSION` (someone saved first).
- Unknown status values and notes longer than 200 characters are 400.

## Homework — `/homework` · Assignments — `/assignments`

The two kinds have the same shape. Permissions: `homework.read/manage`, `assignment.read/manage`.

| Method | Path                                                                                        | Notes                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/{kind}?q&status&sectionId&subjectId&teacherId&academicYearId&dueFrom&dueTo&page&pageSize` | Server pagination; archived hidden unless `status=ARCHIVED`                               |
| GET    | `/{kind}/targets` (manage)                                                                  | Section + subject pairs the caller may create for                                         |
| GET    | `/{kind}/:id`                                                                               | Includes `can` flags                                                                      |
| POST   | `/{kind}`                                                                                   | `{sectionId, subjectId, title, instructions?, assignedDate, dueDate, teacherId?}` → DRAFT |
| PATCH  | `/{kind}/:id`                                                                               | `{…fields, expectedVersion}` (draft/published only)                                       |
| POST   | `/{kind}/:id/publish` · `/archive` · `/assignments/:id/close`                               | `{expectedVersion}`                                                                       |
| DELETE | `/{kind}/:id`                                                                               | Drafts only                                                                               |

Errors: `CLASS_SUBJECT_NOT_ASSIGNED` (404), `SUBJECT_NOT_IN_GRADE`, `DUE_BEFORE_ASSIGNED`,
`ACADEMIC_YEAR_CLOSED`, `ACADEMIC_YEAR_NOT_ACTIVE`, `INVALID_STATUS_TRANSITION`, `NOT_EDITABLE`,
`409 STALE_VERSION`.

## Timetable — `/timetable`

| Method                | Path                                                                                                   | Permission                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| GET                   | `/timetable/periods?branchId&academicYearId`                                                           | timetable.read                                  |
| POST · PATCH · DELETE | `/timetable/periods` · `/timetable/periods/:id`                                                        | timetable.manage                                |
| PUT                   | `/timetable/periods/order` `{branchId, academicYearId, ids[]}`                                         | timetable.manage                                |
| POST · PATCH · DELETE | `/timetable/entries` · `/timetable/entries/:id` `{sectionId, periodId, weekday, subjectId, teacherId}` | timetable.manage                                |
| GET                   | `/timetable/sections/:sectionId`                                                                       | timetable.read (teachers: their sections)       |
| GET                   | `/timetable/teachers/me` · `/timetable/teachers/:teacherId`                                            | timetable.read (others' weeks only school-wide) |

Errors: `SECTION_TIMETABLE_CONFLICT`, `TEACHER_TIMETABLE_CONFLICT`, `PERIOD_OVERLAP`,
`PERIOD_TIMES_INVALID`, `PERIOD_NAME_TAKEN`, `PERIOD_IN_USE`, `PERIOD_NOT_INSTRUCTIONAL`,
`PERIOD_NOT_IN_BRANCH`, `NON_WORKING_DAY`, `TEACHER_NOT_ASSIGNED`, `TEACHER_INACTIVE`,
`SUBJECT_NOT_IN_GRADE`, `ACADEMIC_YEAR_CLOSED`.

## Dashboard

`GET /workspace/dashboard` gains `operations`, scoped like the modules:

- `attendanceToMark`: active classes with students and no sheet for their local today.
- `homeworkDueSoon` / `assignmentsDueSoon`: published work due within the next 7 days.

The activity feed adds class-level events: "Attendance recorded / corrected", "Homework
published", "Assignment published" and "Timetable updated", each for a class.
