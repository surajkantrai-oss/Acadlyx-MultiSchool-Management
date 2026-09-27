# Future-phase notes

Items noticed during Phase 1 that were intentionally **not** implemented.

## Noted during Phase 2 (deliberately not implemented)

- Redis caching of tenant resolution/bootstrap (keyed by normalised domain/key, invalidated on
  update). Correctness first: every tenant request currently reads PostgreSQL.
- Automated DNS verification of custom domains (`verified_at` is set manually today).
- Media uploads for logos/images (branding stores https URLs only).
- Per-feature configuration payloads (flags are boolean today).
- Tenant branches (blueprint §3.1): later school-structure phase.
- Branded native mobile builds per tenant (app id, icons, store listing): white-label build phase.

## Noted during Phase 4 (deliberately not implemented)

- Multi-school tenants in the UI (schema supports several schools per tenant; V1 uses one).
- Platform Admin support view of a tenant's academic setup (needs a separately designed,
  audited support-access mechanism — no impersonation).
- Historical locking beyond "dates frozen once ACTIVE" (e.g. forbidding structural edits of a
  CLOSED year's sections once enrollments exist) — add with Phase 5 enrollments.
- Section capacity enforcement (enrollment phase), board-specific curricula, grading systems.
- Drag-and-drop ordering (up/down controls are provided); bulk import of classes/sections.
- Hard deletion of mistaken setup rows that are still unused.

## Noted during Phase 3 (deliberately not implemented)

- Real SMS and email OTP providers. Delivery is the dev outbox only, and production fails closed.
- OTP step-up for new devices (they are recorded and audited only; approved decision).
- WebAuthn and passkeys (`mfa_method_type` already includes `WEBAUTHN`).
- Custom roles and permissions, bulk user import, parent–student linking and user profiles.
- Platform user management UI (platform users are created with the CLI only).
- Mobile TOTP enrolment (users enrol on the web; mobile supports the MFA challenge).
- Mobile feature screens: the app stops at sign-in, session restore and sign-out.
- Automated audit-log retention and archival.

## CI/CD and deployment phases

- Deployment workflows (staging/production, blueprint §24.1). The quality gate already exists
  in `.github/workflows/ci.yml` and does not deploy.
- AWS/Terraform resources, Secrets Manager integration and CloudWatch/Sentry.
- White-label mobile build pipeline (blueprint §24.2).
