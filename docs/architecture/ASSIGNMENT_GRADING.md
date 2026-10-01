# Assignment grading (Phase 9)

Approved decisions O–R (2026-09-30). This builds on
[ASSIGNMENT_SUBMISSIONS.md](ASSIGNMENT_SUBMISSIONS.md) (Phase 8).

## Model

```
AssignmentSubmission (current)
└── AssignmentSubmissionHistory  (immutable version 1, 2, …)
    └── AssignmentSubmissionGrade   (at most one per exact submission version)
        └── AssignmentSubmissionGradeHistory (append-only; one row per change)
```

- **O — `Assignment.max_marks`** is nullable `NUMERIC(7,2)` and must be > 0 when set.
  - `NULL`: numeric marks are refused (`GRADE_MARKS_NOT_ALLOWED`); feedback is still allowed.
  - `> 0`: `0 ≤ marks_awarded ≤ max_marks`, using exact decimals with at most 2 dp. This is enforced
    by the service and by the trigger `assignment_submission_grades_within_max`.
  - Feedback is limited to 2000 characters.
  - `max_marks` is locked once any grade has been published (`MAX_MARKS_LOCKED`).
- **P — lifecycle** `DRAFT → PUBLISHED`. A published grade can be corrected. The correction is
  stored as a new version, and every change is kept in the history.
- **Q — per exact submission version.** The grade FK is composite (`submission_history_id`,
  `submission_id`, school, tenant), so a grade can never point at another student's or another
  assignment's submission.
- **R — web only.** Grading happens on the School Admin page
  `/assignments/:id/grading`. There is no teacher grading on mobile.

## Who

`assignment_grade.manage`: Principal and School Admin (school-wide), and Teachers only for
assignments in a Section + Subject they are assigned to (others receive 404). Parents, students
and accountants cannot grade.

## Visibility (parents and students)

- Only a **PUBLISHED** grade of the **LATEST** submission version is returned (`grade` on the mobile
  work item). A draft grade and draft feedback are never returned.
- After a resubmission, the new version has no grade yet, so the item shows
  **“Awaiting grading”** (`awaitingGrading: true`). A previous version's grade is **never** shown
  as if it belonged to the latest version.
- The grade is shown with the submission version it belongs to (“For submission version 1”).
- Earlier versions and their grades remain available to staff on the grading page, for audit.

## Concurrency

Grade writes carry `expectedVersion` (0 = no grade yet). Two simultaneous publishes of the same
submission version produce one 201 and one 409, and exactly one published grade.

## Audit

`ASSIGNMENT_GRADE_DRAFTED`, `ASSIGNMENT_GRADE_PUBLISHED` and `ASSIGNMENT_GRADE_CORRECTED`, with
assignment/section ids and the submission version only. Marks and feedback text are never written
to the AuditLog.
