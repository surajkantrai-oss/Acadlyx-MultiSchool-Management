# Results and report cards (Phase 9)

Approved decisions D, J, K, L, M, N, S, U (2026-09-30). The one canonical implementation is
`apps/backend/src/tenant-api/assessment/result-calc.ts`: it is pure and deterministic, and it is
covered by unit tests and API tests.

## Canonical formulas

All arithmetic uses exact decimals. Nothing is rounded until it is displayed.

### Component

| State  | obtained contribution | maximum contribution | passes?                                     |
| ------ | --------------------- | -------------------- | ------------------------------------------- |
| MARKED | stored marks          | component max        | marks ≥ component pass mark (if one is set) |
| ABSENT | 0                     | component max        | **never** (shown as “Absent”)               |
| EXEMPT | excluded              | excluded             | never fails                                 |
| none   | —                     | —                    | result is **INCOMPLETE**                    |

A component the student was not eligible for (decision H) is excluded, like EXEMPT.

### Subject

```
subject_obtained   = Σ obtained of non-exempt components   (ABSENT contributes 0)
subject_maximum    = Σ maximum  of non-exempt components
subject_percentage = subject_obtained / subject_maximum × 100          (exact)
```

A subject **passes** only when both of these hold:

1. the combined subject criterion passes: there is no subject pass mark, or
   `subject_obtained × full_maximum ≥ subject_pass_marks × subject_maximum`. This is the same as
   `obtained ≥ pass_marks` when nothing is exempt, and scales proportionally when exemptions reduce
   the maximum; **and**
2. every component that has its own pass mark passes (and no component is ABSENT).

If every component is EXEMPT, the subject status is `EXEMPT`, its percentage is `null` and its
grade is `null`.

### Overall

Fully EXEMPT subjects are excluded.

```
overall_obtained   = Σ subject_obtained  (non-exempt subjects)
overall_maximum    = Σ subject_maximum   (non-exempt subjects)
overall_percentage = overall_obtained / overall_maximum × 100          (exact)
```

- `INCOMPLETE` when any required mark is missing or its sheet is not finalized. **Publication is
  blocked** in that case.
- Otherwise `PASS` when every non-exempt subject passes, else `FAIL`. There is **no separate
  overall percentage threshold**.
- The overall result is therefore **PASS, FAIL or INCOMPLETE**. Exempt subjects never change it.
  EXEMPT is a subject-level outcome; the shared `result_outcome` enum includes it for subject
  snapshots.
- Edge case (existing behaviour, unit-tested): if **every** subject is fully exempt, there is nothing
  to score, and the overall status is `EXEMPT`, with no percentage and no grade.

### Grades and display

- Grades come from the exam's grade scale, using the **raw** percentage (see
  [EXAMS_AND_MARKS.md](EXAMS_AND_MARKS.md#grade-scales-decision-k)).
- Percentages are shown to **2 decimal places**. The unrounded value is also returned
  (`percentage`) for audit and consistency checks.

## Publication and versioning (decision L)

```
MARKS_FINALIZED ──publish (results.publish)──▶ RESULTS_PUBLISHED   → ResultPublication v1 (current)
     ▲                                               │
     │                                reopen a sheet (reason)
     └── finalize ◀── correct ◀── MARKS_ENTRY ◀──────┘

republish → ResultPublication v2 (current); v1 stays unchanged and is no longer current
```

- Publishing takes a full **snapshot**: `result_publications` stores the school, exam and year
  names. `result_student_snapshots`, `result_subject_snapshots` and `result_component_snapshots`
  store names, maximums, pass marks, states, marks, totals, percentages, grade labels, outcomes and
  the class-teacher remark.
- Snapshots are **immutable**. The app role has SELECT/INSERT only; the one updatable column is
  `result_publications.is_current`, and a partial unique index allows only one current publication
  per exam.
- Two concurrent publish requests produce one 201 and one 409, and only one publication version is
  created (the exam row is locked and version-checked).
- Parents and students read **only the current publication snapshot**. They never read live marks,
  live configuration, drafts or unpublished results. For example, renaming a subject or a grade
  label after publication does not change a published card; the new name appears only in a later
  version.
- While a correction is in progress, the previous version stays visible to parents and students.
  Staff (`results.read` within their scope) can open any version by its publication id.

## Class results and remarks (decision N)

- `GET /exams/:id/results`: the live calculated overview, paginated. Leadership sees all sections;
  a teacher sees only sections where they are the **class teacher**. Other teachers receive 404.
  Accountants have no access.
- Staff live preview: `GET /exams/:id/results/students/:studentId`. It is labelled as a preview and
  is never shown to parents or students.
- General remark: an optional text of up to **500** characters per exam + student, written by the
  class teacher of the student's section or by leadership. It is copied into the snapshot at
  publication.

## Report card (decision M)

- **Web**: the `/exams/:id/results/:studentId` page shows the live preview or a chosen published
  version. It has a print button and a print stylesheet that hides navigation and controls.
- **Mobile**: Results tab → published exam → report card (Parent: selected, verified child;
  Student: self).
- **No PDF generation and no file storage.**
- Contents: school name (branding is runtime and server-driven), student name, admission number,
  grade/section, exam, academic year, each subject with its components (marks, “Absent” or “Exempt”),
  subject total, % and grade, a PASS/FAIL/EXEMPT label, the overall total, % and grade, the overall
  outcome, the remark, and the publication version and date.
- States are always shown as words plus a symbol, never by colour alone.

## Audit

`RESULTS_PUBLISHED` (exam id, version, student count) and `EXAM_REMARK_SAVED` (ids only). Snapshot
contents, marks and remark text are never written to the AuditLog. The School Admin activity feed
shows “Results published · Mid Term” and “Marks finalized · Mid Term · Grade 5 A Mathematics”,
never a student's marks.

## Scale characteristics

Measured on 5,000 students, 8 subjects × 2 components, and 80,000 marks in one exam.

| Request                                                    | Time        | SQL statements |
| ---------------------------------------------------------- | ----------- | -------------- |
| Class results page (whole exam calculated, then paginated) | ~540 ms     | 23             |
| One student's live preview                                 | ~580 ms     | 24             |
| Mobile results list                                        | 11–19 ms    | 23–25          |
| Mobile report card (one snapshot)                          | 15–27 ms    | 13–15          |
| **Publish results for 5,000 students**                     | **~20.5 s** | **94**         |

Publishing writes about 125,000 snapshot rows (5,000 student, 40,000 subject and 80,000 component rows).

- It runs as **one atomic transaction** with an operation-specific **60-second timeout** (`PUBLISH_TX` in `results.service.ts`). The global Prisma transaction timeout (5 s) is unchanged, and nothing else uses the longer budget.
- Two simultaneous publishes still produce exactly one version: the exam row is locked and version-checked.
- A failure rolls everything back, so a partial publication is impossible.
- Publishing runs only on the explicit publish action, never on a read.
- Moving publication to a background job would be a later, separate product decision.
