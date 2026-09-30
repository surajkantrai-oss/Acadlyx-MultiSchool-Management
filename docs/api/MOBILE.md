# Mobile API (Phase 8)

Tenant via `X-Acadlyx-Tenant-Key` (or host). All routes need a tenant session.

| Route                                                                                                                                                 | Who                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /mobile/me`                                                                                                                                      | any                                       |
| `GET /mobile/parent/children` · `…/children/:studentId/{home,attendance,attendance/days,homework,assignments,assignments/:id,homework/:id,timetable}` | Parent (linked child only; else 404)      |
| `GET /mobile/student/{home,attendance,attendance/days,homework,assignments,…/:id,timetable}`                                                          | Student (self)                            |
| `PUT /mobile/student/assignments/:id/submission` `{text?, url?, expectedVersion}`                                                                     | Student                                   |
| `GET /mobile/teacher/assignments/:id/submissions`                                                                                                     | `assignment.read` + Section/Subject scope |

List routes accept `scope=current|past`, `page` and `pageSize` (≤ 50). Error codes: `MOBILE_ROLE_REQUIRED`, `SUBMISSION_INVALID`, `SUBMISSION_STALE`, `SUBMISSION_NOT_ALLOWED`, `ASSIGNMENT_CLOSED`, `ASSIGNMENT_ARCHIVED`, `NO_CURRENT_CLASS`.
