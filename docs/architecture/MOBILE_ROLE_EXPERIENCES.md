# Mobile role experiences (Phase 8)

Approved decisions A–L (2026-09-28). The server decides roles (`GET /mobile/me`: role granted **and** an active profile). The active role in the app is presentation only.

| Role    | Tabs                                   | Capabilities                                                                                                                                                                                                                               |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parent  | Home · Academics · Timetable · Profile | Child switcher; child's class, today's lessons, attendance (Phase 7 formula), homework, assignments + the child's submission (read-only), timetable                                                                                        |
| Student | Home · Work · Timetable · Profile      | Own class, attendance, homework, assignments, **submit / resubmit**, timetable                                                                                                                                                             |
| Teacher | Home · Classes · Work · Profile        | Assigned classes; attendance (today + previous 7 school-local days, versioned saves, conflict reload); create/publish/close/archive homework & assignments for assigned Section + Subject; read-only submissions; My timetable (read-only) |

Other roles (Principal, School Admin, …) see a message pointing to the web School Admin.

## Access model (decision J)

- **Parent:** relationship-scoped — authenticated user → own active Parent profile → `StudentGuardian` → student. Other children are 404.
- **Student:** self-only — authenticated user → own active Student profile.
- **Teacher:** Phase 7 permissions + assigned Section + Subject scope. `attendance.backdate` is not granted.
- Parents/Students hold no school-level read permissions; RLS stays defence in depth.

## Multi-role (decision A)

One user (e.g. Teacher + Parent) switches in Profile → "Use the app as", without signing in again. The choice is stored per school on the device and revalidated against `/mobile/me` at launch. Switching remounts the whole role tree, so no data crosses roles.

## Selected child (decision B)

Stored locally per school; at launch it is kept only if the server still lists the child, else the first linked child (or an empty state). No database table.

## Session, storage and offline

- Refresh token in SecureStore; access token in memory; restore revalidates with the server.
- Sign-out clears the session, refresh token, active role and selected child. All academic data lives in memory only.
- **No offline mutation queue** (decision I): failed saves show an error, typed text stays on screen, Retry is offered.

## Deferred

Fees, notices, messaging, notifications, documents/files, transport, calendar.

## Phase 9 — results and grades

- **Results tab** (Parent: the selected, server-verified child; Student: self). It shows a virtualised list (`FlatList`) of the current published exam results. Selecting one opens the report card: school branding (runtime theme and snapshot school name), the student, exam and year, subjects with their components (marks / “Absent” / “Exempt”), totals, %, grade, PASS/FAIL/EXEMPT, the overall result, the class-teacher remark and the publication version.
- **Unpublished results are never returned.** When nothing has been published, the tab shows “No published results yet”.
- **Assignment grades:** only the published grade of the latest submission version is shown, labelled with that version. After a resubmission the item shows “Awaiting grading”, and a previous grade is never reused.
- **Read-only.** Parents and students cannot edit marks or remarks, publish or reopen. Teacher grading is web-only (decision R).
