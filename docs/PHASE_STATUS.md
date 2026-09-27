# Acadlyx phase status

| Phase | Name                                                       | Status                                      |
| ----- | ---------------------------------------------------------- | ------------------------------------------- |
| 1     | Project Foundation & Infrastructure                        | **COMPLETE** (2026-09-26)                   |
| 2     | Multi-Tenancy & Platform Super Admin                       | **COMPLETE** (2026-09-26)                   |
| 3     | Authentication, RBAC & Security                            | **COMPLETE — awaiting review** (2026-09-27) |
| 4–15  | Later phases per project plan (15 = production deployment) | NOT STARTED                                 |

## Phase 3 verification (2026-09-27)

Uncommitted, awaiting review. The committed HEAD is still the Phase 2 commit. Full command results
are in the Phase 3 report.

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
