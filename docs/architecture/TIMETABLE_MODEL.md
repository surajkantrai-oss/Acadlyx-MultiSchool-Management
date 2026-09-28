# Timetable model (Phase 7)

Approved decisions M–P (2026-09-28).

## Periods (bell schedule)

- **Named periods** (`timetable_periods`) per **Branch + AcademicYear**: name, type, local start
  and end times (`TIME`), and explicit `display_order` (deferrably unique, so reorders are clean).
- **Types:** `INSTRUCTIONAL`, `BREAK`, `LUNCH`, `ASSEMBLY`. Breaks never need fake subjects.
- `start < end` is enforced by a CHECK, and a **GiST exclusion constraint** stops periods of one
  bell schedule from overlapping. It reuses the Phase 4 `btree_gist` extension; no new extension
  is added.
- Periods can be set up for **PLANNED** and **ACTIVE** years. **CLOSED years are read-only.** A
  period with lessons cannot be removed (409 `PERIOD_IN_USE`).

## Entries (the weekly timetable)

- `timetable_entries` = **Section × weekday × period → Subject + Teacher**. A class is a Section;
  there is no Class table.
- **One recurring timetable per academic year** (decision O). There are no effective dates: a
  change edits the current timetable, and every change is audited. **Limitation:** past versions of
  a timetable are not reconstructable in V1.
- Each entry copies its period's branch, year, type and times through a composite FK with
  `ON UPDATE CASCADE`. So when a period is retimed or retyped, its lessons follow automatically and
  the database re-checks every rule.

### Guarantees in the database

- **Section conflict:** `UNIQUE (section_id, weekday, period_id)`. A section's periods never
  overlap, so a section can never hold two lessons at once.
- **Teacher conflict:** an exclusion constraint on `(teacher_id, academic_year_id, weekday,
time range &&)`. It compares **real local times**, so a teacher is caught even across branches
  with different bell schedules (for example 09:00–09:45 against 09:15–10:00).
- **Lessons only in instructional periods:** a CHECK on the copied type. Turning a used period
  into a break fails (`PERIOD_IN_USE`).
- **Same branch and year:** the entry's section and period must share branch and year (composite
  FKs, including a new `sections (id, branch_id, academic_year_id, school_id, tenant_id)` unique).
- **Concurrency:** these constraints hold under concurrent writes. Two simultaneous conflicting
  bookings result in exactly one success.

### Service rules (on top)

- The weekday must be one of the school's **working days** (Phase 4 settings; Saturday allowed if
  configured, never hard-coded).
- The subject must be mapped to the section's grade.
- The teacher must be **ACTIVE** and hold an open **SUBJECT_TEACHER** assignment on that Section +
  Subject.
- The section must be active, and the year not CLOSED.
- Errors are safe and specific: `SECTION_TIMETABLE_CONFLICT`, `TEACHER_TIMETABLE_CONFLICT`,
  `PERIOD_NOT_INSTRUCTIONAL`, `NON_WORKING_DAY`, `TEACHER_NOT_ASSIGNED`, `TEACHER_INACTIVE`,
  `SUBJECT_NOT_IN_GRADE`. Constraint names never reach clients.

### Implementation note

Prisma 7 cannot re-serialise `@db.Time` values that are part of a composite relation key. So
entry inserts and updates use parameterised SQL in the same tenant transaction (same RLS and
constraints), and entry reads never traverse the entry → period relation; periods are loaded by
id instead.

## Views and permissions

- `timetable.read`: weekly grids, rows = periods (breaks labelled), columns = the school's working
  days in week order. Every lesson cell has a full text label for assistive technology.
  - **Teachers:** their own week ("My timetable", which may span branches) and the timetables of
    sections they teach. Other ids return 404.
- `timetable.manage` (Principal, School Admin only): periods and lessons. Teachers cannot edit
  the timetable.
- Out of scope: no calendar or holiday exceptions, A/B weeks, rooms, substitutes or exam timetables.
