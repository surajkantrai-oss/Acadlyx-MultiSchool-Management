# Assignment submissions (Phase 8)

Decisions C–L (2026-09-28).

- **Model:** one current `assignment_submissions` row per assignment + student (unique) and an append-only `assignment_submission_history` row for every accepted version.
- **Content:** text ≤ **5000** chars and/or one **https** URL ≤ **2048** chars; at least one is required. `http:`, `javascript:`, `data:`, `file:` and `ftp:` are rejected (shared validation + DB CHECK). The URL is stored as user text and never fetched.
- **No files. No grading or feedback** (Phase 9).
- **Eligibility (G):** recipients were enrolled in the assignment's Section on its `assigned_date`. A student who transferred out keeps read access but cannot submit. Joining later does not make earlier work theirs.
- **Lifecycle (E):** submit/resubmit only while PUBLISHED, the year is not CLOSED and the student is currently in the Section. After the due date it is accepted as late. CLOSED/ARCHIVED are read-only.
- **Lateness (D):** derived, not stored — the FIRST submission's branch-local date after the due date. Later edits never change it.
- **Concurrency:** `expectedVersion` (0 = first). Double taps and races produce exactly one success and 409 `SUBMISSION_STALE`. The assignment row is share-locked, so a concurrent close is strictly ordered.
- **Identity:** from the session only. Parents read their child's submission (K); teachers read submissions for assignments they manage. Neither can write.
- **Audit:** `ASSIGNMENT_SUBMITTED` / `ASSIGNMENT_RESUBMITTED` with ids and version only — never content.
- **Database:** FORCE RLS on both tables; composite (id, school, tenant) FKs; no DELETE grant; history has SELECT/INSERT only.
