# Homework & assignments (Phase 7)

Approved decisions F–L (2026-09-28).

## Two kinds, one implementation

|                     | Homework                                       | Assignment                                                                    |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Meaning             | Lightweight class task for a Section + Subject | Formal task for a Section + Subject                                           |
| Lifecycle           | `DRAFT → PUBLISHED → ARCHIVED`                 | `DRAFT → PUBLISHED → CLOSED → ARCHIVED` (PUBLISHED → ARCHIVED also allowed)   |
| Student submissions | Never                                          | **Phase 8** (decision I) — text + optional https link when built (decision J) |
| Grading / feedback  | No                                             | No — kept separate from Phase 9 exams/results (decision K)                    |

The two kinds are separate tables (`homework`, `assignments`) served by one `ClassworkService`
and one controller factory, so there is no duplicated logic.

## Rules

- **Dates (decision L):** `assigned_date` and `due_date` are date-only `DATE` columns, exchanged
  as `YYYY-MM-DD`, and apply identically to homework and assignments. `due_date = 2026-09-30`
  means the work is **due on 30 September on the school's local calendar**. There is no time
  component: nothing depends on closing time, the last timetable period, a 23:59 timestamp, the
  browser time zone or UTC-midnight conversion. `due_date ≥ assigned_date` (DB CHECK), and both
  must lie inside the class's academic year. When a comparison with "today" is needed, "today" is
  the branch-local date on the server.
- **Creating and publishing:**
  - The Section must be active in an **ACTIVE** year.
  - The Subject must be mapped to the Section's grade (`GradeSubject`).
  - A teacher must hold an open **SUBJECT_TEACHER** assignment on exactly that Section + Subject.
  - Publishing re-checks all of the above at publish time.
  - A **CLOSED year is read-only.**
- **Author:** `created_by_user_id` always comes from the session. A teacher is recorded as the
  responsible teacher (`teacher_id`); leadership may name an ACTIVE teacher who holds the pair.
  Client-supplied creator ids are never trusted.
- **Editing:** drafts and published work are editable; every edit bumps `version`, and a stale
  `expectedVersion` returns 409. Publishing keeps `published_at`, and the status never resets.
  Closed and archived work is read-only. The audit records changed field **names** only, never
  text bodies.
- **Deleting:** only drafts can be deleted. This is enforced in the database by a **restrictive
  RLS policy** (`draft_only_delete`) on top of the service check. Published work is archived,
  never hard-deleted.
- **Concurrency:** status transitions are conditional updates on `(id, version, status)`, so
  two simultaneous publishes result in exactly one success.
- **Not included:** no attachments or files (documents phase), and no notifications (the
  notification phase).

## Visibility

- **Principal and School Admin:** everything in the school.
- **Teachers:** work of the sections they teach. **Drafts are visible only to their author.**
  Managing (edit, publish, close, archive, delete) requires the Section + Subject pair.
- The API returns server-computed `can` flags; the server re-checks every action.
- Other roles have no access. Students and parents will read **published** work in Phase 8.

## Future consumption (Phase 8)

Published items carry everything a student or parent view needs: class, subject, teacher,
dates and instructions. Submissions will reference assignments through a new table with
server-derived lateness (the due date is compared on the server in the branch time zone).
