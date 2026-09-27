-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "auth_scope" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "credential_type" AS ENUM ('PASSWORD', 'PIN');

-- CreateEnum
CREATE TYPE "login_id_kind" AS ENUM ('STUDENT_ID', 'EMPLOYEE_ID');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('ACCOUNT_ACTIVATION', 'ACCOUNT_RECOVERY', 'PHONE_CHANGE', 'EMAIL_CHANGE', 'NEW_DEVICE');

-- CreateEnum
CREATE TYPE "otp_channel" AS ENUM ('SMS', 'EMAIL', 'ADMIN_ISSUED');

-- CreateEnum
CREATE TYPE "mfa_method_type" AS ENUM ('TOTP', 'WEBAUTHN');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "scope" "auth_scope" NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "password_hash" VARCHAR(255),
    "credential_updated_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_window_started_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_user_roles" (
    "platform_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "role_scope" "auth_scope" NOT NULL DEFAULT 'PLATFORM',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_user_roles_pkey" PRIMARY KEY ("platform_user_id","role_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "display_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(16),
    "login_id" VARCHAR(64),
    "login_id_kind" "login_id_kind",
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_verified_at" TIMESTAMPTZ(3),
    "credential_type" "credential_type",
    "credential_hash" VARCHAR(255),
    "credential_updated_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_window_started_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "role_scope" "auth_scope" NOT NULL DEFAULT 'TENANT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_platform_user_id" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" UUID NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" UUID,
    "installation_hash" CHAR(64) NOT NULL,
    "platform" "device_platform" NOT NULL,
    "label" VARCHAR(100),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" UUID,
    "device_id" UUID,
    "mfa_pending" BOOLEAN NOT NULL DEFAULT false,
    "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(64),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "tenant_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "channel" "otp_channel" NOT NULL,
    "target" VARCHAR(254) NOT NULL,
    "code_hmac" VARCHAR(100) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_methods" (
    "id" UUID NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" UUID,
    "type" "mfa_method_type" NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "last_used_step" BIGINT,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "scope" "auth_scope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" UUID,
    "code_hmac" VARCHAR(100) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_label" VARCHAR(100) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(64),
    "request_id" VARCHAR(128),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "changed_fields" TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_platform_user_id" UUID,
    "actor_label" VARCHAR(100) NOT NULL,
    "tenant_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(64),
    "request_id" VARCHAR(128),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "changed_fields" TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_scope_key" ON "roles"("id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_id_scope_key" ON "permissions"("id", "scope");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_tenant_id_key" ON "users"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_idx" ON "user_roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "user_devices_tenant_id_idx" ON "user_devices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_installation_hash_key" ON "user_devices"("user_id", "installation_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_platform_user_id_installation_hash_key" ON "user_devices"("platform_user_id", "installation_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_id_tenant_id_key" ON "user_devices"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_platform_user_id_revoked_at_idx" ON "sessions"("platform_user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_device_id_idx" ON "sessions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_id_tenant_id_key" ON "sessions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_purpose_idx" ON "otp_challenges"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "otp_challenges_tenant_id_idx" ON "otp_challenges"("tenant_id");

-- CreateIndex
CREATE INDEX "mfa_methods_tenant_id_idx" ON "mfa_methods"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_methods_user_id_type_key" ON "mfa_methods"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_methods_platform_user_id_type_key" ON "mfa_methods"("platform_user_id", "type");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_platform_user_id_idx" ON "mfa_recovery_codes"("platform_user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_tenant_id_idx" ON "mfa_recovery_codes"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_tenant_id_idx" ON "platform_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actor_platform_user_id_idx" ON "platform_audit_logs"("actor_platform_user_id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_scope_fkey" FOREIGN KEY ("role_id", "scope") REFERENCES "roles"("id", "scope") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_scope_fkey" FOREIGN KEY ("permission_id", "scope") REFERENCES "permissions"("id", "scope") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_role_id_role_scope_fkey" FOREIGN KEY ("role_id", "role_scope") REFERENCES "roles"("id", "scope") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_role_scope_fkey" FOREIGN KEY ("role_id", "role_scope") REFERENCES "roles"("id", "scope") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_tenant_id_fkey" FOREIGN KEY ("device_id", "tenant_id") REFERENCES "user_devices"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_tenant_id_fkey" FOREIGN KEY ("session_id", "tenant_id") REFERENCES "sessions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_methods" ADD CONSTRAINT "mfa_methods_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_methods" ADD CONSTRAINT "mfa_methods_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written section (reviewed): integrity, scope separation, RLS, grants.
-- =====================================================================================

-- Identifier normalisation and per-tenant uniqueness (the same phone/email may exist in
-- different tenants as independent accounts; never twice in one tenant).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" IS NULL OR "email" = lower("email")),
  ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "users_login_id_kind_chk" CHECK (("login_id" IS NULL) = ("login_id_kind" IS NULL)),
  ADD CONSTRAINT "users_has_identifier_chk" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL OR "login_id" IS NOT NULL),
  ADD CONSTRAINT "users_credential_pair_chk" CHECK (("credential_hash" IS NULL) = ("credential_type" IS NULL));
CREATE UNIQUE INDEX "users_tenant_email_key" ON "users"("tenant_id", "email") WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "users_tenant_phone_key" ON "users"("tenant_id", "phone") WHERE "phone" IS NOT NULL;
CREATE UNIQUE INDEX "users_tenant_login_id_key" ON "users"("tenant_id", "login_id") WHERE "login_id" IS NOT NULL;

ALTER TABLE "platform_users"
  ADD CONSTRAINT "platform_users_email_lowercase_chk" CHECK ("email" = lower("email"));

-- Role scope separation: tenant users can never hold PLATFORM roles and vice versa.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_scope_chk" CHECK ("role_scope" = 'TENANT');
ALTER TABLE "platform_user_roles" ADD CONSTRAINT "platform_user_roles_platform_scope_chk" CHECK ("role_scope" = 'PLATFORM');

-- Every security row belongs to exactly one scope/owner.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_owner_chk" CHECK (
  ("scope" = 'TENANT' AND "tenant_id" IS NOT NULL AND "user_id" IS NOT NULL AND "platform_user_id" IS NULL)
  OR ("scope" = 'PLATFORM' AND "tenant_id" IS NULL AND "user_id" IS NULL AND "platform_user_id" IS NOT NULL));
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_scope_owner_chk" CHECK (
  ("scope" = 'TENANT' AND "tenant_id" IS NOT NULL AND "user_id" IS NOT NULL AND "platform_user_id" IS NULL)
  OR ("scope" = 'PLATFORM' AND "tenant_id" IS NULL AND "user_id" IS NULL AND "platform_user_id" IS NOT NULL));
ALTER TABLE "mfa_methods" ADD CONSTRAINT "mfa_methods_scope_owner_chk" CHECK (
  ("scope" = 'TENANT' AND "tenant_id" IS NOT NULL AND "user_id" IS NOT NULL AND "platform_user_id" IS NULL)
  OR ("scope" = 'PLATFORM' AND "tenant_id" IS NULL AND "user_id" IS NULL AND "platform_user_id" IS NOT NULL));
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_scope_owner_chk" CHECK (
  ("scope" = 'TENANT' AND "tenant_id" IS NOT NULL AND "user_id" IS NOT NULL AND "platform_user_id" IS NULL)
  OR ("scope" = 'PLATFORM' AND "tenant_id" IS NULL AND "user_id" IS NULL AND "platform_user_id" IS NOT NULL));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_order_chk" CHECK ("idle_expires_at" <= "absolute_expires_at");
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_attempts_chk" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts");

-- Hot lookups: live sessions per identity; unused refresh tokens.
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions"("absolute_expires_at") WHERE "revoked_at" IS NULL;

-- ---------------------------------------------------------------- Row Level Security
-- Tenant-owned auth tables: same model as Phase 2. Platform rows (tenant_id NULL) never match
-- app_current_tenant_id(), so the tenant role cannot see platform sessions/devices/MFA.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;               ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;          ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;            ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;      ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_devices" ENABLE ROW LEVEL SECURITY;        ALTER TABLE "user_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;      ALTER TABLE "otp_challenges" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mfa_methods" ENABLE ROW LEVEL SECURITY;         ALTER TABLE "mfa_methods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;  ALTER TABLE "mfa_recovery_codes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;          ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "users" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "user_roles" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "sessions" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "refresh_tokens" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "user_devices" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "otp_challenges" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "mfa_methods" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "mfa_recovery_codes" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
-- Audit is append-only for the tenant role: INSERT + read-back of own tenant, no UPDATE/DELETE.
CREATE POLICY "tenant_isolation_select" ON "audit_logs" FOR SELECT TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation_insert" ON "audit_logs" FOR INSERT TO acadlyx_app
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Platform-only tables: RLS on with NO policy for acadlyx_app (deny-all even if a grant slips
-- in later). The owner/platform role bypasses via BYPASSRLS.
ALTER TABLE "platform_users" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "platform_users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_user_roles" ENABLE ROW LEVEL SECURITY;  ALTER TABLE "platform_user_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;  ALTER TABLE "platform_audit_logs" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- Grants (least privilege)
-- RBAC catalogue is global reference data (no tenant rows): read-only for the tenant role.
GRANT SELECT ON "roles", "permissions", "role_permissions" TO acadlyx_app;
-- Identity: the tenant path reads users/roles and updates login state; it never creates or
-- deletes users or role assignments (platform path only).
GRANT SELECT ON "users" TO acadlyx_app;
-- Column-level: tenant auth flows may change credentials, verification, lockout and activation
-- state — never id, tenant_id, login identifiers of record or display name.
GRANT UPDATE ("status", "email", "phone", "email_verified_at", "phone_verified_at",
  "credential_type", "credential_hash", "credential_updated_at", "failed_login_count",
  "lockout_count", "lockout_window_started_at", "locked_until", "last_login_at", "updated_at")
  ON "users" TO acadlyx_app;
GRANT SELECT ON "user_roles" TO acadlyx_app;
GRANT SELECT, INSERT, UPDATE ON "sessions", "refresh_tokens", "user_devices", "otp_challenges" TO acadlyx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_methods", "mfa_recovery_codes" TO acadlyx_app;
GRANT SELECT, INSERT ON "audit_logs" TO acadlyx_app;
-- No grants on platform_users, platform_user_roles, platform_audit_logs.
