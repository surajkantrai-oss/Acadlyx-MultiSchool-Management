# Attendance model (Phase 7)

Daily class attendance, approved decisions A–E (2026-09-28).

## Granularity and statuses

- **Daily, per class.** There is exactly one `attendance_sessions` row per Section and
  school-local date (`UNIQUE (section_id, date)`), and one `attendance_records` row per student
  (`UNIQUE (session_id, student_id)`).
- **Statuses:** exactly `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`. There is no half-day in Phase 7.
- **Notes:** an optional note (≤ 200 characters) is allowed on any record. It is for brief
  operational context only; the UI warns against medical detail, and diagnoses are never collected.
- **Attendance % (student summary)** for the academic year:

  ```
  (PRESENT + LATE) ÷ (all marked records excluding EXCUSED) = (PRESENT + LATE) ÷ (PRESENT + LATE + ABSENT)
  ```

  | Status   | Numerator | Denominator |
  | -------- | --------- | ----------- |
  | PRESENT  | yes       | yes         |
  | LATE     | yes       | yes         |
  | ABSENT   | no        | yes         |
  | EXCUSED  | no        | no          |
  | Unmarked | no        | no          |

  EXCUSED is never treated as absent, and a roster student left unmarked on a saved sheet is not
  absent. Example: 18 present, 2 late, 3 absent, 2 excused → 20 ÷ 23 = 86.9565…%. When nothing
  eligible is marked (no marks, or only EXCUSED) the rate is `null` ("no data"), not 0%. The
  calculation is `attendancePercentage()` in `@acadlyx/validation`.

- **Display rounding (separate from the calculation):** the API returns `attendanceRate` rounded
  to one decimal place (`roundRate`, half away from zero), so the example is shown as `87%`
  (86.96 → 87.0). Counts are returned alongside it, so clients never need to recompute.

## Dates and time zones

- The date is the **school-local calendar date** in the class's branch time zone (IANA,
  `branches.timezone`), stored as `DATE`. "Today" is computed on the server for that time zone,
  never from the browser clock or UTC midnight.
- **Future dates are always rejected.**
- **Teachers** may record or correct attendance for **today through the previous 7 school-local
  calendar days** (calendar days, not working days), in sections they are assigned to. Example
  with local today = 28 Sep: 21–28 Sep allowed; 20 Sep and earlier refused
  (`ATTENDANCE_OUTSIDE_WINDOW`).
- **Principal and School Admin** may record or correct **any past date** in a non-CLOSED academic
  year. In code this wider window is the `attendance.backdate` permission (held only by those two
  roles, and only with school-wide scope). It widens the date window and nothing else; the
  7-day window itself comes from `attendance.manage` plus the date policy.
- The academic year must be **ACTIVE** and the date inside its range. PLANNED years are not
  markable; **CLOSED years are read-only for everyone**. Inactive classes, branches and grades are
  read-only.

## Roster eligibility

The roster for date D contains every student whose enrollment in **this** section covers D:
`start_date ≤ D` and (`end_date IS NULL` or `end_date > D`). A transfer or withdrawal takes
effect on its end date. Any student already recorded on the sheet is always shown, so history
never disappears. `Student.status` alone is never used. A student who moves from 5 A to 5 B
keeps their 5 A history on the 5 A sheets, and it is never migrated. Only students on the roster
(or already on the sheet) may be saved; other ids, including other tenants' or other schools'
students, are refused with `STUDENT_NOT_ON_ROSTER`.

## Workflow, corrections and concurrency

- **Immediate save (decision D):** the first save creates the session and records; later saves
  are corrections. The UI flow is "Mark all present" → change exceptions → Save, and it warns on
  unsaved changes.
- **Optimistic concurrency:** the session carries a `version`. A correction must send
  `expectedVersion`; if someone saved in between, the result is `409 STALE_VERSION` and nothing is
  overwritten silently. A race between two first saves is resolved by the unique index (one wins,
  the other gets 409).
- **History (decision E):** `attendance_record_history` is append-only (the app role has no
  UPDATE or DELETE on it). It records every value: the initial mark (`from_status` NULL) and every
  correction (old → new status and note, the staff member, and the time). The class page shows the
  correction log.
- **Audit:** one session-level `ATTENDANCE_RECORDED` / `ATTENDANCE_CORRECTED` event per save, with
  metadata limited to section, date and counts. There are no student ids, statuses or notes in the
  AuditLog (those live in the history table).
- **No deletes:** attendance sessions and records can never be deleted by the application role.

## Scope and permissions

- `attendance.read` / `attendance.manage` / `attendance.backdate`.
- **Principal, School Admin:** all three, school-wide.
- **Teachers:** read + manage, but only for sections where they hold an **open TeacherAssignment**
  (class or subject teacher) through their own ACTIVE teacher profile. This is the Phase 6
  data-scope rule (`people.read_all` = school-wide). Other ids return 404.
- Other roles have no attendance permissions.

## Activity feed and privacy

The dashboard feed shows class-level lines only ("Attendance recorded — Grade 5 A"), never an
individual student's status.
