-- Phase 5 — people, enrollment and bulk onboarding.
-- Generated DDL first (prisma migrate diff against the Phase 4 database; the two DROP INDEX
-- statements for Phase 4's hand-written DEFERRABLE unique constraints were removed — Prisma cannot
-- model deferrable constraints and reports them as drift). Reviewed hand-written section at the end.
-- See docs/architecture/PEOPLE_AND_ENROLLMENT_MODEL.md.

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('ACTIVE', 'INACTIVE', 'WITHDRAWN', 'GRADUATED');

-- CreateEnum
CREATE TYPE "teacher_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "guardian_relationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('ACTIVE', 'TRANSFERRED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "teacher_assignment_type" AS ENUM ('SUBJECT_TEACHER', 'CLASS_TEACHER');

-- CreateEnum
CREATE TYPE "import_type" AS ENUM ('STUDENTS', 'PARENTS', 'TEACHERS');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('READY', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('INVALID', 'VALID', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "admission_number" VARCHAR(40) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "middle_name" VARCHAR(80),
    "last_name" VARCHAR(80),
    "preferred_name" VARCHAR(80),
    "date_of_birth" DATE,
    "admission_date" DATE,
    "status" "student_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_status" "student_status",
    "to_status" "student_status" NOT NULL,
    "reason" VARCHAR(200),
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "parent_code" VARCHAR(40),
    "first_name" VARCHAR(80) NOT NULL,
    "middle_name" VARCHAR(80),
    "last_name" VARCHAR(80),
    "email" VARCHAR(254),
    "phone" VARCHAR(16),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "relationship" "guardian_relationship" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "pickup_authorized" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_id" VARCHAR(40) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "middle_name" VARCHAR(80),
    "last_name" VARCHAR(80),
    "email" VARCHAR(254),
    "phone" VARCHAR(16),
    "joining_date" DATE,
    "status" "teacher_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID,
    "type" "teacher_assignment_type" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "type" "import_type" NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'READY',
    "template_version" SMALLINT NOT NULL,
    "original_filename" VARCHAR(200) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "succeeded_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" VARCHAR(200),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "bulk_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_import_rows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "import_row_status" NOT NULL,
    "data" JSONB,
    "errors" JSONB,
    "entity_id" UUID,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "bulk_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "students_tenant_id_school_id_status_idx" ON "students"("tenant_id", "school_id", "status");

-- CreateIndex
CREATE INDEX "students_school_id_last_name_first_name_idx" ON "students"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_tenant_id_key" ON "students"("user_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_admission_number_key" ON "students"("school_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_id_school_id_tenant_id_key" ON "students"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_status_history_student_id_created_at_idx" ON "student_status_history"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "student_status_history_tenant_id_idx" ON "student_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "parents_tenant_id_school_id_idx" ON "parents"("tenant_id", "school_id");

-- CreateIndex
CREATE INDEX "parents_school_id_last_name_first_name_idx" ON "parents"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "parents_school_id_phone_idx" ON "parents"("school_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "parents_user_id_tenant_id_key" ON "parents"("user_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "parents_id_school_id_tenant_id_key" ON "parents"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_guardians_parent_id_idx" ON "student_guardians"("parent_id");

-- CreateIndex
CREATE INDEX "student_guardians_tenant_id_idx" ON "student_guardians"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_student_id_parent_id_key" ON "student_guardians"("student_id", "parent_id");

-- CreateIndex
CREATE INDEX "teachers_tenant_id_school_id_status_idx" ON "teachers"("tenant_id", "school_id", "status");

-- CreateIndex
CREATE INDEX "teachers_school_id_last_name_first_name_idx" ON "teachers"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_user_id_tenant_id_key" ON "teachers"("user_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_school_id_employee_id_key" ON "teachers"("school_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_id_school_id_tenant_id_key" ON "teachers"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_enrollments_student_id_academic_year_id_idx" ON "student_enrollments"("student_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "student_enrollments_section_id_status_idx" ON "student_enrollments"("section_id", "status");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_academic_year_id_idx" ON "student_enrollments"("tenant_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_teacher_id_ended_at_idx" ON "teacher_assignments"("teacher_id", "ended_at");

-- CreateIndex
CREATE INDEX "teacher_assignments_section_id_ended_at_idx" ON "teacher_assignments"("section_id", "ended_at");

-- CreateIndex
CREATE INDEX "teacher_assignments_subject_id_idx" ON "teacher_assignments"("subject_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_tenant_id_idx" ON "teacher_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "bulk_import_jobs_tenant_id_school_id_created_at_idx" ON "bulk_import_jobs"("tenant_id", "school_id", "created_at");

-- CreateIndex
CREATE INDEX "bulk_import_jobs_tenant_id_status_idx" ON "bulk_import_jobs"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_import_jobs_id_school_id_tenant_id_key" ON "bulk_import_jobs"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "bulk_import_rows_job_id_status_idx" ON "bulk_import_rows"("job_id", "status");

-- CreateIndex
CREATE INDEX "bulk_import_rows_tenant_id_idx" ON "bulk_import_rows"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_import_rows_job_id_row_number_key" ON "bulk_import_rows"("job_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_academic_year_id_school_id_tenant_id_key" ON "sections"("id", "academic_year_id", "school_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_parent_id_school_id_tenant_id_fkey" FOREIGN KEY ("parent_id", "school_id", "tenant_id") REFERENCES "parents"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_academic_year_id_school_id__fkey" FOREIGN KEY ("section_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "sections"("id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacher_id_school_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "school_id", "tenant_id") REFERENCES "teachers"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_section_id_school_id_tenant_id_fkey" FOREIGN KEY ("section_id", "school_id", "tenant_id") REFERENCES "sections"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_import_jobs" ADD CONSTRAINT "bulk_import_jobs_school_id_tenant_id_fkey" FOREIGN KEY ("school_id", "tenant_id") REFERENCES "schools"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_job_id_school_id_tenant_id_fkey" FOREIGN KEY ("job_id", "school_id", "tenant_id") REFERENCES "bulk_import_jobs"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written section (reviewed): integrity, RLS, grants, account-creation function.
-- =====================================================================================

-- ---- Integrity -------------------------------------------------------------------------
-- Identifiers are stored trimmed + upper-case (services normalise; the database refuses others).
ALTER TABLE "students" ADD CONSTRAINT "students_admission_number_format"
  CHECK ("admission_number" ~ '^[A-Z0-9][A-Z0-9/_.-]{0,39}$');
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_employee_id_format"
  CHECK ("employee_id" ~ '^[A-Z0-9][A-Z0-9/_.-]{0,39}$');
ALTER TABLE "parents" ADD CONSTRAINT "parents_parent_code_format"
  CHECK ("parent_code" IS NULL OR "parent_code" ~ '^[A-Z0-9][A-Z0-9/_.-]{0,39}$');
ALTER TABLE "students" ADD CONSTRAINT "students_first_name_present" CHECK (btrim("first_name") <> '');
ALTER TABLE "parents"  ADD CONSTRAINT "parents_first_name_present"  CHECK (btrim("first_name") <> '');
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_first_name_present" CHECK (btrim("first_name") <> '');
ALTER TABLE "students" ADD CONSTRAINT "students_dob_sane" CHECK ("date_of_birth" IS NULL OR "date_of_birth" >= DATE '1900-01-01');
ALTER TABLE "parents"  ADD CONSTRAINT "parents_email_lower"  CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_email_lower" CHECK ("email" IS NULL OR "email" = lower("email"));

-- School-unique parent code when set (the ONLY key imports use to match an existing parent).
CREATE UNIQUE INDEX "parents_school_parent_code_key" ON "parents" ("school_id", "parent_code") WHERE "parent_code" IS NOT NULL;

-- Guardians: 0 or 1 primary per student.
CREATE UNIQUE INDEX "student_guardians_one_primary" ON "student_guardians" ("student_id") WHERE "is_primary";

-- Enrollment: at most one ACTIVE enrollment per student per academic year; sane dates.
CREATE UNIQUE INDEX "student_enrollments_one_active_per_year" ON "student_enrollments" ("student_id", "academic_year_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_dates_ordered"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_active_open"
  CHECK (("status" = 'ACTIVE') = ("end_date" IS NULL));

-- Teacher assignments: subject only for subject teachers; no duplicate active mapping; at most
-- one active class teacher per section; ended_at after started_at. Co-teaching (several
-- teachers for one section+subject) remains possible.
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_by_type"
  CHECK (("type" = 'SUBJECT_TEACHER') = ("subject_id" IS NOT NULL));
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_period"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
CREATE UNIQUE INDEX "teacher_assignments_active_subject_key" ON "teacher_assignments" ("teacher_id", "section_id", "subject_id")
  WHERE "ended_at" IS NULL AND "type" = 'SUBJECT_TEACHER';
CREATE UNIQUE INDEX "teacher_assignments_one_class_teacher" ON "teacher_assignments" ("section_id")
  WHERE "ended_at" IS NULL AND "type" = 'CLASS_TEACHER';

-- Import bookkeeping.
ALTER TABLE "bulk_import_jobs" ADD CONSTRAINT "bulk_import_jobs_counts_nonneg" CHECK (
  "total_rows" >= 0 AND "valid_rows" >= 0 AND "invalid_rows" >= 0 AND "processed_rows" >= 0
  AND "succeeded_rows" >= 0 AND "failed_rows" >= 0 AND "valid_rows" + "invalid_rows" = "total_rows");
ALTER TABLE "bulk_import_jobs" ADD CONSTRAINT "bulk_import_jobs_template_version" CHECK ("template_version" >= 1);
ALTER TABLE "bulk_import_jobs" ADD CONSTRAINT "bulk_import_jobs_file_hash_hex" CHECK ("file_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_row_number" CHECK ("row_number" >= 2);

-- ---- Row Level Security (same transaction-local tenant context as Phases 2–4) -----------
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;               ALTER TABLE "students" FORCE ROW LEVEL SECURITY;
ALTER TABLE "student_status_history" ENABLE ROW LEVEL SECURITY; ALTER TABLE "student_status_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "parents" ENABLE ROW LEVEL SECURITY;                ALTER TABLE "parents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "student_guardians" ENABLE ROW LEVEL SECURITY;      ALTER TABLE "student_guardians" FORCE ROW LEVEL SECURITY;
ALTER TABLE "teachers" ENABLE ROW LEVEL SECURITY;               ALTER TABLE "teachers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "student_enrollments" ENABLE ROW LEVEL SECURITY;    ALTER TABLE "student_enrollments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "teacher_assignments" ENABLE ROW LEVEL SECURITY;    ALTER TABLE "teacher_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bulk_import_jobs" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "bulk_import_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bulk_import_rows" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "bulk_import_rows" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "students" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "student_status_history" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "parents" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "student_guardians" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "teachers" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "student_enrollments" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "teacher_assignments" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "bulk_import_jobs" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "bulk_import_rows" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- ---- Grants for the restricted tenant role (least privilege) ---------------------------
-- People, enrollments and assignments are never deleted (lifecycle/history instead). Only a
-- guardian link (relationship, not a person) may be removed. Ownership/scope columns are not
-- updatable. Status history is append-only.
GRANT SELECT ON "students", "student_status_history", "parents", "student_guardians", "teachers",
  "student_enrollments", "teacher_assignments", "bulk_import_jobs", "bulk_import_rows" TO acadlyx_app;
GRANT INSERT ON "students", "student_status_history", "parents", "student_guardians", "teachers",
  "student_enrollments", "teacher_assignments", "bulk_import_jobs", "bulk_import_rows" TO acadlyx_app;
GRANT UPDATE ("user_id", "admission_number", "first_name", "middle_name", "last_name", "preferred_name",
              "date_of_birth", "admission_date", "status", "updated_at") ON "students" TO acadlyx_app;
GRANT UPDATE ("user_id", "parent_code", "first_name", "middle_name", "last_name", "email", "phone",
              "is_active", "updated_at") ON "parents" TO acadlyx_app;
GRANT UPDATE ("user_id", "employee_id", "first_name", "middle_name", "last_name", "email", "phone",
              "joining_date", "status", "updated_at") ON "teachers" TO acadlyx_app;
GRANT UPDATE ("relationship", "is_primary", "pickup_authorized", "is_emergency_contact", "updated_at")
  ON "student_guardians" TO acadlyx_app;
GRANT DELETE ON "student_guardians" TO acadlyx_app;
GRANT UPDATE ("status", "end_date", "updated_at") ON "student_enrollments" TO acadlyx_app;
GRANT UPDATE ("ended_at", "updated_at") ON "teacher_assignments" TO acadlyx_app;
GRANT UPDATE ("status", "processed_rows", "succeeded_rows", "failed_rows", "failure_reason",
              "confirmed_at", "started_at", "completed_at", "updated_at") ON "bulk_import_jobs" TO acadlyx_app;
GRANT UPDATE ("status", "data", "errors", "entity_id", "processed_at") ON "bulk_import_rows" TO acadlyx_app;

-- ---- Profile account creation (School Admin "Create account") ----------------------------
-- The tenant role still has NO direct INSERT on users/user_roles. This single SECURITY DEFINER
-- function is the only tenant-path way to create an identity, and it can only create:
--   * a PENDING_ACTIVATION user (no credential — activation uses the Phase 3 OTP/code flow),
--   * in the CURRENT tenant (app_current_tenant_id(); fails without context),
--   * holding exactly one of the roles STUDENT, PARENT or TEACHER.
-- Identifier uniqueness is enforced by the existing users indexes.
CREATE FUNCTION app_create_profile_account(
  p_user_id uuid, p_user_role_id uuid, p_display_name text, p_email text, p_phone text,
  p_login_id text, p_login_id_kind login_id_kind, p_role_key text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant_id();
  v_role uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant context required' USING ERRCODE = '42501';
  END IF;
  IF p_role_key NOT IN ('STUDENT', 'PARENT', 'TEACHER') THEN
    RAISE EXCEPTION 'role % cannot be granted here', p_role_key USING ERRCODE = '42501';
  END IF;
  SELECT "id" INTO v_role FROM "roles" WHERE "key" = p_role_key AND "scope" = 'TENANT';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'unknown role' USING ERRCODE = '42501';
  END IF;
  INSERT INTO "users" ("id", "tenant_id", "status", "display_name", "email", "phone", "login_id",
                       "login_id_kind", "updated_at")
  VALUES (p_user_id, v_tenant, 'PENDING_ACTIVATION', p_display_name, p_email, p_phone, p_login_id,
          p_login_id_kind, now());
  INSERT INTO "user_roles" ("id", "tenant_id", "user_id", "role_id", "role_scope")
  VALUES (p_user_role_id, v_tenant, p_user_id, v_role, 'TENANT');
  RETURN p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION app_create_profile_account(uuid, uuid, text, text, text, text, login_id_kind, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_profile_account(uuid, uuid, text, text, text, text, login_id_kind, text) TO acadlyx_app;
