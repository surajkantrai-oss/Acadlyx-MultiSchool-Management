-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tenant_domain_type" AS ENUM ('PLATFORM_SUBDOMAIN', 'CUSTOM', 'ADMIN');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(200),
    "status" "tenant_status" NOT NULL DEFAULT 'DRAFT',
    "first_activated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "type" "tenant_domain_type" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_brandings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_name" VARCHAR(120) NOT NULL,
    "short_name" VARCHAR(40),
    "logo_url" VARCHAR(2048),
    "favicon_url" VARCHAR(2048),
    "primary_color" CHAR(7) NOT NULL,
    "secondary_color" CHAR(7),
    "accent_color" CHAR(7),
    "background_image_url" VARCHAR(2048),
    "login_image_url" VARCHAR(2048),
    "support_email" VARCHAR(254),
    "support_phone" VARCHAR(20),
    "website_url" VARCHAR(2048),
    "footer_text" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_brandings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature_key" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configurations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_key_key" ON "tenants"("key");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_brandings_tenant_id_key" ON "tenant_brandings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_tenant_id_feature_key_key" ON "tenant_features"("tenant_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configurations_tenant_id_key_key" ON "tenant_configurations"("tenant_id", "key");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_brandings" ADD CONSTRAINT "tenant_brandings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_configurations" ADD CONSTRAINT "tenant_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written section (reviewed): integrity constraints, tenant isolation (RLS), grants.
-- Requires roles from prisma/setup-roles.sql (acadlyx owner with BYPASSRLS, acadlyx_app).
-- =====================================================================================

-- Integrity: identifiers and domains are normalised at the database level as well.
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_key_format_chk" CHECK ("key" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  ADD CONSTRAINT "tenants_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,62}$'),
  ADD CONSTRAINT "tenants_archived_at_chk" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "tenant_domains"
  ADD CONSTRAINT "tenant_domains_domain_format_chk" CHECK ("domain" = lower("domain") AND "domain" !~ '[/:\s]' AND "domain" LIKE '%.%');

ALTER TABLE "tenant_brandings"
  ADD CONSTRAINT "tenant_brandings_primary_color_chk" CHECK ("primary_color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "tenant_brandings_secondary_color_chk" CHECK ("secondary_color" IS NULL OR "secondary_color" ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT "tenant_brandings_accent_color_chk" CHECK ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9A-Fa-f]{6}$');

-- At most one primary domain per tenant and domain type.
CREATE UNIQUE INDEX "tenant_domains_one_primary_per_type_idx"
  ON "tenant_domains"("tenant_id", "type") WHERE "is_primary";

-- Current tenant for this transaction. Set only via
--   SELECT set_config('app.tenant_id', <uuid>, true)   -- transaction-local
-- by TenantPrismaService. Unset/empty => NULL => policies match no rows (fail closed).
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Row Level Security. FORCE makes policies apply to every role without BYPASSRLS
-- (the owner role acadlyx is granted BYPASSRLS explicitly for platform operations).
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_brandings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_brandings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_features" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_features" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_configurations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tenants"
  FOR ALL TO acadlyx_app
  USING ("id" = app_current_tenant_id())
  WITH CHECK ("id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "tenant_domains"
  FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "tenant_brandings"
  FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "tenant_features"
  FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "tenant_configurations"
  FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Least privilege for the tenant-scoped role. Tenant records themselves are read-only on the
-- tenant path; lifecycle/identity changes happen only through the platform path.
GRANT USAGE ON SCHEMA public TO acadlyx_app;
GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO acadlyx_app;
GRANT SELECT ON "tenants" TO acadlyx_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_domains", "tenant_brandings", "tenant_features", "tenant_configurations" TO acadlyx_app;
