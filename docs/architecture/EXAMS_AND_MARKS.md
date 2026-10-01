# Exams and marks (Phase 9)

Approved decisions A–K, S–V (2026-09-30). Schema: migration
`20260930100000_phase_9_exams_marks_results_report_cards`.

## Structure

```
Exam (school + academic year; name unique case-insensitively per school + year)
└── ExamSubject (grade + subject; the subject must be taught in that grade; optional pass mark)
    └── ExamComponent (e.g. Theory / Practical; max marks NUMERIC(7,2) > 0; optional pass mark ≤ max)
        └── ExamComponentSchedule (one per BRANCH: date + start/end time)
```

- **A — grade-level exams.** An exam covers one or more grades through its subjects; there is no
  per-section exam.
- **B — components are relational rows**, never JSON. A subject's maximum is the simple sum of its
  components (decision U).
- **E — branch-aware schedules.** Each component has at most one schedule per branch. Schedules of
  the same exam + grade + branch may not overlap in time (PostgreSQL `EXCLUDE USING gist`).
  Publishing an exam requires every component to be scheduled for every branch that has sections of
  that grade.
- **V — exams are independent.** There is no weighting between exams and no term aggregation.

## Lifecycle (decision F)

```
DRAFT → PUBLISHED → MARKS_ENTRY → MARKS_FINALIZED → RESULTS_PUBLISHED → ARCHIVED
```

| Step             | Who (permission)  | Rule                                                                 |
| ---------------- | ----------------- | -------------------------------------------------------------------- |
| edit structure   | `exam.manage`     | DRAFT only. Name/dates/description may still change while PUBLISHED. |
| `publish`        | `exam.manage`     | At least one subject; every component has a schedule for each branch |
| `open-marks`     | `exam.manage`     | Mark sheets become editable                                          |
| `finalize-marks` | `exam.manage`     | Every required mark sheet is FINALIZED (`MARK_SHEETS_NOT_FINALIZED`) |
| results publish  | `results.publish` | See [RESULTS_AND_REPORT_CARDS.md](RESULTS_AND_REPORT_CARDS.md)       |
| `archive`        | `exam.manage`     | Read-only afterwards; published results stay readable                |
| delete           | `exam.manage`     | DRAFT only, and only when no marks exist                             |

Every transition carries `expectedVersion`; the exam row is locked `FOR UPDATE`, so racing
transitions have exactly one winner (the other receives 409). A CLOSED academic year is read-only.

## Mark sheets (decision G)

One sheet per **exam subject + section**, created on the first save.

```
(no sheet) → DRAFT → SUBMITTED → FINALIZED
                                   │
                         reopen (reason 3–500 chars)
                                   ▼
                               REOPENED → SUBMITTED → FINALIZED
```

- **Teachers** (`marks.enter`) may edit and submit only sheets for a Section + Subject where they
  hold an open `SUBJECT_TEACHER` TeacherAssignment. Every other sheet returns 404.
- **Leadership** (`marks.finalize`: Principal, School Admin) may edit any sheet and finalize SUBMITTED
  sheets. They may also reopen a SUBMITTED sheet (send it back to the teacher) or a FINALIZED sheet,
  always with a reason. Reopening takes the exam back to MARKS_ENTRY.
- Submitting requires every eligible student to have a state for every component
  (`MARKS_INCOMPLETE`).
- A SUBMITTED or FINALIZED sheet is locked for teachers (`MARK_SHEET_LOCKED`).

### Mark states (decisions C, D)

| State  | Stored                 | Meaning                                                |
| ------ | ---------------------- | ------------------------------------------------------ |
| (none) | no row                 | Not entered yet: the result is INCOMPLETE              |
| MARKED | `marks_obtained` 0…max | Marks as entered (exact decimal, ≤ 2 dp)               |
| ABSENT | `marks_obtained` NULL  | Counts as 0 of max and always fails; UI shows “Absent” |
| EXEMPT | `marks_obtained` NULL  | Excluded from obtained and maximum; never fails        |

Marks are validated in the service (0 ≤ marks ≤ component max, at most 2 decimal places; `-1`, `100.01` on a
100-mark paper, `12.345` and non-numbers such as `AB` are refused) **and** in the database:

- a CHECK ties state to value;
- the trigger `student_exam_marks_within_max` rejects marks above the component maximum;
- the trigger `exam_components_max_covers_marks` blocks lowering a maximum below marks already stored.

### Eligibility (decision H)

A student must sit a component when they were enrolled in the section on the scheduled date of the
paper for that section's branch. Mid-exam transfers are handled per paper: for example, a student
who moves from 5 A to 5 B between two papers sits the first paper in 5 A and the second in 5 B.
Components a student was not eligible for are excluded like EXEMPT.

### Concurrency

- Every save, submit, finalize and reopen carries the sheet `expectedVersion`. The sheet row is
  locked, so two edits of the same version produce one 200 and one 409 (`STALE_VERSION`). There is
  no silent last-write-wins.
- Races that are tested: save vs save, save vs submit, save vs finalize, and reopen vs reopen. In
  each case there is exactly one winner, finalized marks are never overwritten, and at most one
  REOPENED event is recorded.

### History and corrections

- `student_exam_mark_history` is append-only (SELECT/INSERT grants only). It records one row per
  change, holding the previous and new state and marks, the version, the actor, and the reopen
  reason when the change was made after a reopen.
- `exam_mark_sheet_events` records every status transition with its actor and reason.
- The generic AuditLog records `MARKS_SAVED` (counts only), `MARK_SHEET_SUBMITTED`,
  `MARK_SHEET_FINALIZED` and `MARK_SHEET_REOPENED`, with ids and subject name only. Marks are never
  stored in it.

## Grade scales (decision K)

`GradeScale` belongs to **school + academic year**. An exam may optionally reference one scale.

- Bands are half-open ranges `[min, max)`; the top band also includes 100. The bands must tile
  0–100 with no gaps: the service validates full coverage, and a gist `EXCLUDE` constraint prevents
  overlaps. Labels are unique (case-insensitive) within a scale.
- A scale used by any exam that is no longer DRAFT cannot be changed or deleted (`GRADE_SCALE_IN_USE`).
- The grade is looked up from the **raw, unrounded** percentage by exact cross-multiplication
  (`obtained × 100` compared with `bound × maximum`). Display rounding (2 dp) is never used to choose
  a grade. For example, 89.995 % is shown as “90.00” but graded in the 80–90 band (unit-tested).
- An exam without a grade scale produces results without grades.

## Exact arithmetic (decisions S, T)

All marks are `NUMERIC(7,2)` and are processed with `Prisma.Decimal`, never JavaScript floating
point. The formulas are in [RESULTS_AND_REPORT_CARDS.md](RESULTS_AND_REPORT_CARDS.md).

## Mark-sheet list (scale)

`GET /exams/:id/sheets` is **paginated** (`page`, `pageSize`: default 50, maximum 100).

- Rows are built from the exam structure and enrollments only.
- Completion counts are loaded **only for the sheets on the current page**, with one keys query on the existing `student_exam_marks_sheet_id_idx` index.
- The list never reads every mark in the exam, and no new index was needed (checked with `EXPLAIN ANALYZE`).

Measured on 5,000 students, 100 sections, 800 sheets and 80,000 marks in one exam:

| Request                                     | Time      | SQL statements |
| ------------------------------------------- | --------- | -------------- |
| Sheet list, 50 per page (pages 1, 8 and 16) | 79–100 ms | 24 each        |
| Sheet list, 100 per page                    | 96 ms     | 24             |
| Teacher sheet list                          | 27 ms     | 31             |
| Open a 50-student sheet                     | 13–19 ms  | 27–29          |

Saving marks is batched: one INSERT for all new marks and one INSERT for all history rows.

- 100 new marks: 77 ms, 63 statements (before batching: about 260 statements).
- 100 changed marks: 308 ms, 159 statements. Each changed mark still gets its own `UPDATE`, because it carries its own value and version.
