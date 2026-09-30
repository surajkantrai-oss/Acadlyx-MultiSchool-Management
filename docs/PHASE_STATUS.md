# Acadlyx phase status

| Phase | Name                                                       | Status                                      |
| ----- | ---------------------------------------------------------- | ------------------------------------------- |
| 1     | Project Foundation & Infrastructure                        | **COMPLETE** (2026-09-26)                   |
| 2     | Multi-Tenancy & Platform Super Admin                       | **COMPLETE** (2026-09-26)                   |
| 3     | Authentication, RBAC & Security                            | **COMPLETE** (2026-09-27, commit `1366890`) |
| 4     | School & Academic Configuration                            | **COMPLETE** (2026-09-27, commit `acd41c5`) |
| 5     | Students, Parents, Teachers & Bulk Onboarding              | **COMPLETE** (2026-09-27, commit `64bc4e1`) |
| 6     | School Admin Portal Core                                   | **COMPLETE** (2026-09-28, commit `d079903`) |
| 7     | Attendance, Homework, Assignments & Timetable              | **COMPLETE** (2026-09-28, commit `acdd3b5`) |
| 8     | White-Label Mobile App & Role Experiences                  | **COMPLETE — awaiting review** (2026-09-29) |
| 9–15  | Later phases per project plan (15 = production deployment) | NOT STARTED                                 |

## Phase 7 verification (2026-09-28)

Uncommitted, awaiting review. HEAD is `d079903` (Phase 6). Migration
`phase_7_attendance_homework_assignments_timetable`.

| Check                                                                                                                                                                      | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Migration applied; Phase 2–5 migrations unchanged; status OK                                                                                                               | PASS   |
| Fresh-database replay (roles → 5 migrations → generate → RBAC sync → seed ×2 → full tests)                                                                                 | PASS   |
| Backend e2e: attendance, homework, assignments, timetable, concurrency, teacher/subject scope, A→B/B→C/C→A, same-tenant school isolation, audit/feed                       | PASS   |
| Final checks: teacher window (today/−1/−7 allowed, −8/future/closed denied), branch-timezone boundary, attendance % formula (unit + API), date-only deadlines (both kinds) | PASS   |
| Direct RLS tests on the 7 Phase 7 tables                                                                                                                                   | PASS   |
| School Admin e2e (attendance, homework, assignments, timetable, isolation)                                                                                                 | PASS   |
| Negative controls (scoping off → RLS holds; permission weakened → fails; teacher scope removed → fails; service timetable checks bypassed → DB still blocks)               | PASS   |
| format / lint / typecheck / tests / build / mobile validate                                                                                                                | PASS   |
| Browser walkthrough (Principal/School Admin, Teacher, School B)                                                                                                            | PASS   |
| iOS regression                                                                                                                                                             | PASS   |

## Phase 6 verification (2026-09-27)

Committed as `d079903` (pushed). No new migration.

| Check                                                                                                                                | Result |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Backend workspace API e2e (dashboard, activity feed, classes, search, access, teacher scope, A→B/B→C/C→A, same-tenant second school) | PASS   |
| School Admin e2e (navigation, dashboard/context, classes, search, access, 404 copy, denial, school B isolation)                      | PASS   |
| Negative controls (app scoping off → RLS holds; access permission bypass → fails; teacher scope removed → fails)                     | PASS   |
| Fresh-database replay (roles → 4 migrations → generate → RBAC sync → seed ×2 → full tests)                                           | PASS   |
| format / lint / typecheck / tests / build / mobile validate                                                                          | PASS   |
| Browser walkthrough (SCHOOL_A admin + teacher; SCHOOL_B isolation; parent/student denial)                                            | PASS   |
| iOS regression (branding, PIN login, session restore, logout)                                                                        | PASS   |

## Phase 5 verification (2026-09-27)

Committed as `64bc4e1`.

| Check                                                                                                                 | Result |
| --------------------------------------------------------------------------------------------------------------------- | ------ |
| Migration `phase_5_people_bulk_onboarding` applied; Phase 2/3/4 migrations unchanged; status OK                       | PASS   |
| Fresh-database replay (roles → 4 migrations → generate → RBAC sync → seed ×2 → backend tests)                         | PASS   |
| Backend unit + e2e: people API, accounts, enrollment, assignments, imports (queue, worker, retries, Redis outage)     | PASS   |
| Direct RLS tests on the 9 Phase 5 tables (fail-closed, A→B/B→C/C→A, cross-school FKs, grants, invariants)             | PASS   |
| School Admin e2e (people flow via BFF, multipart import → completion, template download, role gating, cross-school)   | PASS   |
| Negative controls (app scoping off → RLS holds; permission check off → tests fail; identity checks off → DB FK holds) | PASS   |
| format / lint / typecheck / build / mobile validate                                                                   | PASS   |
| Browser walkthrough as SCHOOL_A School Admin; SCHOOL_B shows none of SCHOOL_A's people                                | PASS   |
| iOS regression (branding, PIN login, session restore, logout)                                                         | PASS   |

## Phase 4 verification (2026-09-27)

Committed as `acd41c5`.

| Check                                                                                                             | Result |
| ----------------------------------------------------------------------------------------------------------------- | ------ |
| Migration `phase_4_school_academic_configuration` applied; Phase 2/3 migrations unchanged; status OK              | PASS   |
| Fresh-database replay (roles → 3 migrations → generate → RBAC sync → seed ×2 → backend tests)                     | PASS   |
| Backend unit + e2e incl. academic API (RBAC, rules, A→B/B→C/C→A, IDOR, concurrency, audit) and RLS                | PASS   |
| School Admin e2e (status + BFF auth + School Setup persistence, role gating, cross-school)                        | PASS   |
| Platform Admin auth regression e2e                                                                                | PASS   |
| Negative controls (app scoping off → RLS holds; BYPASSRLS client → tests fail; permission check off → tests fail) | PASS   |
| format / lint / typecheck / build / mobile validate                                                               | PASS   |
| Browser walkthrough as SCHOOL_A School Admin; SCHOOL_B shows none of SCHOOL_A's data                              | PASS   |
| iOS regression (branding, PIN login, session restore, logout)                                                     | PASS   |

## Phase 3 verification (2026-09-27)

Committed as `1366890`. Full command results are in the Phase 3 report.

| Check                                                                                   | Result |
| --------------------------------------------------------------------------------------- | ------ |
| Migration `phase_3_authentication_rbac_security` applied (Phase 2 migration unchanged)  | PASS   |
| Fresh-database replay (roles → migrate deploy → status → backend tests)                 | PASS   |
| Backend unit + e2e (auth, attacks, OTP, platform, RLS, hardening, tenancy)              | PASS   |
| School Admin e2e (status 200/404/403 + BFF cookies/CSRF/refresh/logout)                 | PASS   |
| Platform Admin e2e (protected pages, forced TOTP enrolment, MFA, refresh, logout)       | PASS   |
| Negative controls (permission check, tenant match, session check, RLS context removed)  | PASS   |
| Lint / typecheck / build / mobile validate                                              | PASS   |
| iOS Simulator: branded login, wrong PIN, sign-in, session restore on relaunch, sign-out | PASS   |

## Phase 2 verification (2026-09-26)

| Check                                                                                          | Result                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------- |
| Migration `phase_2_multi_tenancy` applied; `db:status` up to date                              | PASS                            |
| Fresh-cluster replay (roles → migrate deploy → status → backend tests)                         | PASS                            |
| RLS direct-database tests (A→B, B→C, C→A; no leak; concurrency)                                | PASS                            |
| Application-path isolation tests (TenantPrismaService)                                         | PASS                            |
| Tenant resolution / status enforcement / conflict tests                                        | PASS                            |
| Platform API e2e (create, update, lifecycle, domains, branding, features, configuration, list) | PASS                            |
| Negative controls (RLS context removed; app scoping disabled)                                  | PASS (tests failed as expected) |
| Platform Admin UI flow (create → brand → domain → features → activate)                         | PASS                            |
| School Admin white-label (school-a blue / school-b green / DRAFT blocked)                      | PASS                            |
| Mobile tenant bootstrap on iOS Simulator (SCHOOL_A)                                            | PASS                            |
| Phase 1 checks still passing                                                                   | PASS                            |

Final command results are recorded in the Phase 2 report.

## Phase 1 verification (2026-09-26)

| Check                                                  | Result |
| ------------------------------------------------------ | ------ |
| `pnpm install` (no peer issues)                        | PASS   |
| `pnpm lint` (zero warnings)                            | PASS   |
| `pnpm typecheck`                                       | PASS   |
| `pnpm test`: packages 7, backend unit 8 + e2e 10       | PASS   |
| `pnpm build`: packages, backend, both web apps         | PASS   |
| `pnpm validate:mobile`: iOS and Android bundles export | PASS   |
| Prisma client generation                               | PASS   |
| PostgreSQL / Redis / BullMQ connectivity (e2e)         | PASS   |
| Health 200 when up / 503 when Redis down               | PASS   |
| Graceful shutdown (SIGTERM)                            | PASS   |
| Dev stack running (4000/4001/4002/8081)                | PASS   |
| iOS Simulator smoke test (Expo Go, iPhone 17 Pro Max)  | PASS   |
| CI quality gate defined (`.github/workflows/ci.yml`)   | PASS   |

Phase 1 note: at the time no migrations existed, so `pnpm db:status` exited non-zero. Resolved
in Phase 2.
