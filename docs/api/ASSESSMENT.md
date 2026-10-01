# Assessment API (Phase 9)

All routes are under `/api/v1`, need a tenant session, and are scoped to the caller's school.
Every mutation that changes versioned state takes `expectedVersion`; a stale version returns 409.

| Route                                                                                           | Permission (+ scope)                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET/POST /grade-scales` · `PUT/DELETE /grade-scales/:id`                                       | read `exam.read`; write `exam.manage`                                   |
| `GET /exams` · `GET /exams/:id`                                                                 | `exam.read` (teachers: non-DRAFT exams that include a grade they teach) |
| `POST /exams` · `PATCH/DELETE /exams/:id`                                                       | `exam.manage`                                                           |
| `POST /exams/:id/transitions/{publish,open-marks,finalize-marks,archive}`                       | `exam.manage`                                                           |
| `POST /exams/:id/subjects` · `PATCH/DELETE …/subjects/:examSubjectId`                           | `exam.manage` (DRAFT only)                                              |
| `POST …/subjects/:examSubjectId/components` · `PATCH/DELETE /exams/:id/components/:componentId` | `exam.manage` (DRAFT only)                                              |
| `PUT/DELETE /exams/:id/components/:componentId/schedules/:branchId`                             | `exam.manage`                                                           |
| `GET /exams/:id/sheets`                                                                         | `marks.enter` (teachers: own Section + Subject)                         |
| `GET/PUT /exams/:id/sheets/:examSubjectId/:sectionId`                                           | `marks.enter` + Section/Subject scope                                   |
| `POST …/:sectionId/submit`                                                                      | `marks.enter` + scope                                                   |
| `POST …/:sectionId/finalize` · `…/reopen {reason}`                                              | `marks.finalize`                                                        |
| `GET /exams/:id/results` · `GET /exams/:id/results/students/:studentId`                         | `results.read` (teachers: class-teacher sections only)                  |
| `PUT /exams/:id/remarks/:studentId {remark}`                                                    | `results.read` + class teacher, or leadership                           |
| `POST /exams/:id/results/publish` · `GET /exams/:id/publications`                               | `results.publish` / `results.read`                                      |
| `GET /result-publications/:publicationId/students/:studentId`                                   | `results.read` + scope                                                  |
| `GET /assignments/:id/grading`                                                                  | `assignment_grade.manage` + Section/Subject scope                       |
| `PUT /assignments/:id/submissions/:submissionId/versions/:version/grade` · `…/grade/publish`    | `assignment_grade.manage` + scope                                       |

Parent and student result routes are listed in [MOBILE.md](MOBILE.md).

Main error codes: `EXAM_NOT_FOUND`, `EXAM_NAME_TAKEN`, `INVALID_STATUS_TRANSITION`,
`SCHEDULE_CONFLICT`, `MARKS_ENTRY_CLOSED`, `MARK_SHEET_LOCKED`, `MARKS_INCOMPLETE`, `MARKS_FINALIZED`,
`MARK_SHEETS_NOT_FINALIZED`, `INVALID_MARK`, `STUDENT_NOT_ELIGIBLE`, `STALE_VERSION`,
`RESULTS_INCOMPLETE`, `RESULT_NOT_PUBLISHED`, `GRADE_SCALE_INVALID`, `GRADE_SCALE_IN_USE`,
`GRADE_INVALID`, `GRADE_MARKS_NOT_ALLOWED`, `MAX_MARKS_LOCKED`.

Design: [EXAMS_AND_MARKS.md](../architecture/EXAMS_AND_MARKS.md),
[RESULTS_AND_REPORT_CARDS.md](../architecture/RESULTS_AND_REPORT_CARDS.md),
[ASSIGNMENT_GRADING.md](../architecture/ASSIGNMENT_GRADING.md).
