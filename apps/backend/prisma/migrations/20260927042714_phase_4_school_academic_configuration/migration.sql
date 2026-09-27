-- Phase 4 — school & academic configuration.
-- Generated DDL first; the reviewed hand-written section (integrity, RLS, grants, backfill) is at
-- the end. See docs/architecture/SCHOOL_ACADEMIC_MODEL.md.

-- Needed for the academic-year non-overlap exclusion constraint (uuid "=" inside a GiST index).
-- btree_gist is a trusted extension: the database owner may create it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "school_board" AS ENUM ('CBSE', 'ICSE', 'STATE_BOARD', 'IB', 'CAMBRIDGE', 'OTHER');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "academic_year_status" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "schools" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "short_name" VARCHAR(40),
    "code" VARCHAR(20),
    "board" "school_board",
    "board_name" VARCHAR(100),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "website" VARCHAR(2048),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(12),
    "country" CHAR(2),
    "timezone" VARCHAR(64) NOT NULL,
    "week_start_day" "weekday" NOT NULL DEFAULT 'MONDAY',
    "working_days" "weekday"[],
    "academic_year_start_month" SMALLINT NOT NULL DEFAULT 4,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(12),
    "country" CHAR(2),
    "timezone" VARCHAR(64) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "academic_year_status" NOT NULL DEFAULT 'PLANNED',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "capacity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grade_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schools_tenant_id_idx" ON "schools"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "schools_id_tenant_id_key" ON "schools"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "branches_tenant_id_school_id_idx" ON "branches"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_school_id_code_key" ON "branches"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_school_id_tenant_id_key" ON "branches"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "academic_years_tenant_id_school_id_idx" ON "academic_years"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_name_key" ON "academic_years"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_id_school_id_tenant_id_key" ON "academic_years"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "grades_tenant_id_school_id_idx" ON "grades"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_school_id_code_key" ON "grades"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "grades_id_school_id_tenant_id_key" ON "grades"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "sections_tenant_id_grade_id_idx" ON "sections"("tenant_id", "grade_id");

-- CreateIndex
CREATE INDEX "sections_tenant_id_branch_id_academic_year_id_idx" ON "sections"("tenant_id", "branch_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "sections_academic_year_id_school_id_tenant_id_idx" ON "sections"("academic_year_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "sections_grade_id_school_id_tenant_id_idx" ON "sections"("grade_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "sections_branch_id_school_id_tenant_id_idx" ON "sections"("branch_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_branch_id_academic_year_id_grade_id_code_key" ON "sections"("branch_id", "academic_year_id", "grade_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_school_id_tenant_id_key" ON "sections"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "subjects_tenant_id_school_id_idx" ON "subjects"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_code_key" ON "subjects"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_id_school_id_tenant_id_key" ON "subjects"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "grade_subjects_tenant_id_grade_id_idx" ON "grade_subjects"("tenant_id", "grade_id");

-- CreateIndex
CREATE INDEX "grade_subjects_subject_id_school_id_tenant_id_idx" ON "grade_subjects"("subject_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_subjects_grade_id_subject_id_key" ON "grade_subjects"("grade_id", "subject_id");

-- AddForeignKey
ALTER TABLE "schools" ADD CONSTRAINT "schools_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_branch_id_school_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "school_id", "tenant_id") REFERENCES "branches"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "school_id", "tenant_id") REFERENCES "academic_years"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_id_school_id_tenant_id_fkey" FOREIGN KEY ("grade_id", "school_id", "tenant_id") REFERENCES "grades"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_grade_id_school_id_tenant_id_fkey" FOREIGN KEY ("grade_id", "school_id", "tenant_id") REFERENCES "grades"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Hand-written section (reviewed): integrity, RLS, grants, backfill.
-- =====================================================================================

-- ---- Integrity -------------------------------------------------------------------------
-- Codes are stored upper-case (services normalise; the database refuses anything else).
ALTER TABLE "schools"  ADD CONSTRAINT "schools_code_format"  CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "grades"   ADD CONSTRAINT "grades_code_format"   CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "sections" ADD CONSTRAINT "sections_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');

ALTER TABLE "schools" ADD CONSTRAINT "schools_board_name_only_other"
  CHECK ("board_name" IS NULL OR "board" = 'OTHER');
ALTER TABLE "schools" ADD CONSTRAINT "schools_country_format" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
ALTER TABLE "branches" ADD CONSTRAINT "branches_country_format" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
ALTER TABLE "schools" ADD CONSTRAINT "schools_start_month_range" CHECK ("academic_year_start_month" BETWEEN 1 AND 12);
ALTER TABLE "schools" ADD CONSTRAINT "schools_working_days_present" CHECK (cardinality("working_days") >= 1);

-- School code unique within the tenant when set.
CREATE UNIQUE INDEX "schools_tenant_code_key" ON "schools" ("tenant_id", "code") WHERE "code" IS NOT NULL;

-- Exactly one primary branch per school (the service keeps one whenever any branch exists);
-- a primary branch is always active.
CREATE UNIQUE INDEX "branches_one_primary_per_school" ON "branches" ("school_id") WHERE "is_primary";
ALTER TABLE "branches" ADD CONSTRAINT "branches_primary_is_active" CHECK (NOT "is_primary" OR "is_active");

-- Academic years: real date ranges, one current (ACTIVE) year per school, no overlaps.
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_dates_ordered" CHECK ("start_date" < "end_date");
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_current_is_active"
  CHECK (NOT "is_current" OR "status" = 'ACTIVE');
CREATE UNIQUE INDEX "academic_years_one_current_per_school" ON "academic_years" ("school_id") WHERE "is_current";
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_no_overlap"
  EXCLUDE USING gist ("school_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&);

-- Explicit ordering. Unique but DEFERRABLE so a reorder can permute values in one transaction.
ALTER TABLE "grades" ADD CONSTRAINT "grades_display_order_nonneg" CHECK ("display_order" >= 0);
ALTER TABLE "grades" ADD CONSTRAINT "grades_school_display_order_key"
  UNIQUE ("school_id", "display_order") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "sections" ADD CONSTRAINT "sections_display_order_nonneg" CHECK ("display_order" >= 0);
ALTER TABLE "sections" ADD CONSTRAINT "sections_scope_display_order_key"
  UNIQUE ("branch_id", "academic_year_id", "grade_id", "display_order") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "sections" ADD CONSTRAINT "sections_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "grade_subjects" ADD CONSTRAINT "grade_subjects_display_order_nonneg" CHECK ("display_order" >= 0);

-- ---- Backfill: every existing tenant gets its School (new tenants: TenantsService) ----------
-- Name from the white-label school name (fallback: tenant display name); academic defaults from
-- the tenant's Phase 2 configuration when present.
INSERT INTO "schools" ("id", "tenant_id", "name", "short_name", "timezone", "week_start_day",
                       "working_days", "academic_year_start_month", "created_at", "updated_at")
SELECT gen_random_uuid(),
       t."id",
       COALESCE(b."school_name", t."display_name"),
       b."short_name",
       COALESCE((SELECT c."value" #>> '{}' FROM "tenant_configurations" c
                  WHERE c."tenant_id" = t."id" AND c."key" = 'general.timezone'), 'Asia/Kolkata'),
       'MONDAY',
       ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']::"weekday"[],
       COALESCE((SELECT (c."value" #>> '{}')::int FROM "tenant_configurations" c
                  WHERE c."tenant_id" = t."id" AND c."key" = 'general.academic_year_start_month'), 4),
       now(), now()
FROM "tenants" t
LEFT JOIN "tenant_brandings" b ON b."tenant_id" = t."id"
WHERE NOT EXISTS (SELECT 1 FROM "schools" s WHERE s."tenant_id" = t."id");

-- ---- Row Level Security (same transaction-local tenant context as Phases 2/3) -------------
ALTER TABLE "schools" ENABLE ROW LEVEL SECURITY;        ALTER TABLE "schools" FORCE ROW LEVEL SECURITY;
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "academic_years" ENABLE ROW LEVEL SECURITY; ALTER TABLE "academic_years" FORCE ROW LEVEL SECURITY;
ALTER TABLE "grades" ENABLE ROW LEVEL SECURITY;         ALTER TABLE "grades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "sections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "grade_subjects" ENABLE ROW LEVEL SECURITY; ALTER TABLE "grade_subjects" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "schools" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "branches" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "academic_years" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "grades" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "sections" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "subjects" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "grade_subjects" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- ---- Grants for the restricted tenant role (least privilege) ------------------------------
-- No DELETE except for the grade_subjects mapping: structure is deactivated, never deleted.
-- Ownership/scope columns (id, tenant_id, school_id, created_at; a section's branch, year and
-- grade) are not updatable. Schools are provisioned by the platform path only (no INSERT).
GRANT SELECT ON "schools", "branches", "academic_years", "grades", "sections", "subjects", "grade_subjects" TO acadlyx_app;
GRANT INSERT ON "branches", "academic_years", "grades", "sections", "subjects", "grade_subjects" TO acadlyx_app;
GRANT UPDATE ("name", "short_name", "code", "board", "board_name", "email", "phone", "website",
              "address_line1", "address_line2", "city", "state", "postal_code", "country",
              "timezone", "week_start_day", "working_days", "academic_year_start_month", "updated_at")
  ON "schools" TO acadlyx_app;
GRANT UPDATE ("name", "code", "email", "phone", "address_line1", "address_line2", "city", "state",
              "postal_code", "country", "timezone", "is_primary", "is_active", "updated_at")
  ON "branches" TO acadlyx_app;
GRANT UPDATE ("name", "start_date", "end_date", "status", "is_current", "updated_at")
  ON "academic_years" TO acadlyx_app;
GRANT UPDATE ("name", "code", "display_order", "is_active", "updated_at") ON "grades" TO acadlyx_app;
GRANT UPDATE ("name", "code", "display_order", "capacity", "is_active", "updated_at") ON "sections" TO acadlyx_app;
GRANT UPDATE ("name", "code", "is_active", "updated_at") ON "subjects" TO acadlyx_app;
GRANT UPDATE ("is_required", "display_order", "updated_at") ON "grade_subjects" TO acadlyx_app;
GRANT DELETE ON "grade_subjects" TO acadlyx_app;
