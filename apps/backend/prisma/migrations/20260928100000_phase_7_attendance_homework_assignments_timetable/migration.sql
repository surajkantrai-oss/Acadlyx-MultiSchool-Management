-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "homework_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "timetable_period_type" AS ENUM ('INSTRUCTIONAL', 'BREAK', 'LUNCH', 'ASSEMBLY');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "from_status" "attendance_status",
    "to_status" "attendance_status" NOT NULL,
    "from_note" VARCHAR(200),
    "to_note" VARCHAR(200),
    "changed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_record_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "instructions" VARCHAR(5000),
    "assigned_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "homework_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "instructions" VARCHAR(5000),
    "assigned_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "timetable_period_type" NOT NULL DEFAULT 'INSTRUCTIONAL',
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timetable_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "period_type" "timetable_period_type" NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "weekday" "weekday" NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_tenant_id_school_id_date_idx" ON "attendance_sessions"("tenant_id", "school_id", "date");

-- CreateIndex
CREATE INDEX "attendance_sessions_academic_year_id_school_id_tenant_id_idx" ON "attendance_sessions"("academic_year_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_section_id_date_key" ON "attendance_sessions"("section_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_id_school_id_tenant_id_key" ON "attendance_sessions"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_status_idx" ON "attendance_records"("student_id", "status");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_idx" ON "attendance_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_id_key" ON "attendance_records"("session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_id_school_id_tenant_id_key" ON "attendance_records"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "attendance_record_history_record_id_created_at_idx" ON "attendance_record_history"("record_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_record_history_tenant_id_idx" ON "attendance_record_history"("tenant_id");

-- CreateIndex
CREATE INDEX "homework_section_id_status_due_date_idx" ON "homework"("section_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "homework_teacher_id_status_idx" ON "homework"("teacher_id", "status");

-- CreateIndex
CREATE INDEX "homework_tenant_id_school_id_status_due_date_idx" ON "homework"("tenant_id", "school_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "assignments_section_id_status_due_date_idx" ON "assignments"("section_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "assignments_teacher_id_status_idx" ON "assignments"("teacher_id", "status");

-- CreateIndex
CREATE INDEX "assignments_tenant_id_school_id_status_due_date_idx" ON "assignments"("tenant_id", "school_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "timetable_periods_tenant_id_school_id_idx" ON "timetable_periods"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_periods_branch_id_academic_year_id_name_key" ON "timetable_periods"("branch_id", "academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_periods_id_school_id_tenant_id_key" ON "timetable_periods"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_periods_id_branch_id_academic_year_id_type_start__key" ON "timetable_periods"("id", "branch_id", "academic_year_id", "type", "start_time", "end_time", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "timetable_entries_teacher_id_weekday_idx" ON "timetable_entries"("teacher_id", "weekday");

-- CreateIndex
CREATE INDEX "timetable_entries_period_id_idx" ON "timetable_entries"("period_id");

-- CreateIndex
CREATE INDEX "timetable_entries_tenant_id_school_id_academic_year_id_idx" ON "timetable_entries"("tenant_id", "school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_section_id_weekday_period_id_key" ON "timetable_entries"("section_id", "weekday", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_branch_id_academic_year_id_school_id_tenant_id_key" ON "sections"("id", "branch_id", "academic_year_id", "school_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_academic_year_id_school_id__fkey" FOREIGN KEY ("section_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "sections"("id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "school_id", "tenant_id") REFERENCES "academic_years"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_school_id_tenant_id_fkey" FOREIGN KEY ("session_id", "school_id", "tenant_id") REFERENCES "attendance_sessions"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record_history" ADD CONSTRAINT "attendance_record_history_record_id_school_id_tenant_id_fkey" FOREIGN KEY ("record_id", "school_id", "tenant_id") REFERENCES "attendance_records"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_section_id_school_id_tenant_id_fkey" FOREIGN KEY ("section_id", "school_id", "tenant_id") REFERENCES "sections"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework" ADD CONSTRAINT "homework_teacher_id_school_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "school_id", "tenant_id") REFERENCES "teachers"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_section_id_school_id_tenant_id_fkey" FOREIGN KEY ("section_id", "school_id", "tenant_id") REFERENCES "sections"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_school_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "school_id", "tenant_id") REFERENCES "teachers"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_branch_id_school_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "school_id", "tenant_id") REFERENCES "branches"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "school_id", "tenant_id") REFERENCES "academic_years"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_id_branch_id_academic_year_id_sc_fkey" FOREIGN KEY ("section_id", "branch_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "sections"("id", "branch_id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_period_id_branch_id_academic_year_id_per_fkey" FOREIGN KEY ("period_id", "branch_id", "academic_year_id", "period_type", "start_time", "end_time", "school_id", "tenant_id") REFERENCES "timetable_periods"("id", "branch_id", "academic_year_id", "type", "start_time", "end_time", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_school_id_tenant_id_fkey" FOREIGN KEY ("teacher_id", "school_id", "tenant_id") REFERENCES "teachers"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================
-- Hand-written section (reviewed): integrity, conflict protection, RLS, grants.
-- =====================================================================================

-- ---- Integrity -------------------------------------------------------------------------
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_version_positive" CHECK ("version" >= 1);
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_note_present"
  CHECK ("note" IS NULL OR btrim("note") <> '');
ALTER TABLE "attendance_record_history" ADD CONSTRAINT "attendance_record_history_changed"
  CHECK ("from_status" IS DISTINCT FROM "to_status" OR "from_note" IS DISTINCT FROM "to_note");

ALTER TABLE "homework" ADD CONSTRAINT "homework_title_present" CHECK (btrim("title") <> '');
ALTER TABLE "homework" ADD CONSTRAINT "homework_dates_ordered" CHECK ("due_date" >= "assigned_date");
ALTER TABLE "homework" ADD CONSTRAINT "homework_version_positive" CHECK ("version" >= 1);
ALTER TABLE "homework" ADD CONSTRAINT "homework_published_at_set"
  CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL);
ALTER TABLE "homework" ADD CONSTRAINT "homework_archived_at_set"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_title_present" CHECK (btrim("title") <> '');
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_dates_ordered" CHECK ("due_date" >= "assigned_date");
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_version_positive" CHECK ("version" >= 1);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_published_at_set"
  CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_closed_at_set"
  CHECK ("status" NOT IN ('CLOSED') OR "closed_at" IS NOT NULL);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_archived_at_set"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_times_ordered" CHECK ("start_time" < "end_time");
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_name_present" CHECK (btrim("name") <> '');
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_display_order_nonneg" CHECK ("display_order" >= 0);
-- Explicit, deferrable ordering per branch + year (same pattern as Phase 4 grades/sections).
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_scope_display_order_key"
  UNIQUE ("branch_id", "academic_year_id", "display_order") DEFERRABLE INITIALLY DEFERRED;

-- Entries only on instructional periods; the copied type/times follow the period (FK cascade).
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_instructional_only"
  CHECK ("period_type" = 'INSTRUCTIONAL');
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_times_ordered" CHECK ("start_time" < "end_time");

-- ---- Conflict protection (reuses the Phase 4 btree_gist extension; no new extension) ---------
-- Periods of one branch + year never overlap in time.
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_no_overlap"
  EXCLUDE USING gist (
    "branch_id" WITH =,
    "academic_year_id" WITH =,
    tsrange(DATE '2000-01-01' + "start_time", DATE '2000-01-01' + "end_time", '[)') WITH &&
  );
-- A teacher is never in two places at once: compared on REAL local times, so different
-- branches' bell schedules (e.g. 09:00–09:45 vs 09:15–10:00) still conflict.
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_no_overlap"
  EXCLUDE USING gist (
    "teacher_id" WITH =,
    "academic_year_id" WITH =,
    "weekday" WITH =,
    tsrange(DATE '2000-01-01' + "start_time", DATE '2000-01-01' + "end_time", '[)') WITH &&
  );
-- (A section holding two lessons in the same slot is prevented by the unique
--  (section_id, weekday, period_id); a section's periods never overlap, see above.)

-- ---- Row Level Security --------------------------------------------------------------------
ALTER TABLE "attendance_sessions" ENABLE ROW LEVEL SECURITY;       ALTER TABLE "attendance_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;        ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_record_history" ENABLE ROW LEVEL SECURITY; ALTER TABLE "attendance_record_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "homework" ENABLE ROW LEVEL SECURITY;                  ALTER TABLE "homework" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;               ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "timetable_periods" ENABLE ROW LEVEL SECURITY;         ALTER TABLE "timetable_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "timetable_entries" ENABLE ROW LEVEL SECURITY;         ALTER TABLE "timetable_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "attendance_sessions" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "attendance_records" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "attendance_record_history" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "homework" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "assignments" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "timetable_periods" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "timetable_entries" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
-- Only drafts may ever be deleted; published work is archived, never hard-deleted.
CREATE POLICY "draft_only_delete" ON "homework" AS RESTRICTIVE FOR DELETE TO acadlyx_app
  USING ("status" = 'DRAFT');
CREATE POLICY "draft_only_delete" ON "assignments" AS RESTRICTIVE FOR DELETE TO acadlyx_app
  USING ("status" = 'DRAFT');

-- ---- Grants (least privilege for the restricted application role) --------------------------
GRANT SELECT, INSERT ON "attendance_sessions", "attendance_records", "attendance_record_history",
  "homework", "assignments", "timetable_periods", "timetable_entries" TO acadlyx_app;
-- Scope/identity columns are never updatable; history is append-only.
GRANT UPDATE ("version", "updated_by_user_id", "updated_at") ON "attendance_sessions" TO acadlyx_app;
GRANT UPDATE ("status", "note", "updated_at") ON "attendance_records" TO acadlyx_app;
GRANT UPDATE ("teacher_id", "title", "instructions", "assigned_date", "due_date", "status", "version",
  "published_at", "archived_at", "updated_at") ON "homework" TO acadlyx_app;
GRANT UPDATE ("teacher_id", "title", "instructions", "assigned_date", "due_date", "status", "version",
  "published_at", "closed_at", "archived_at", "updated_at") ON "assignments" TO acadlyx_app;
GRANT UPDATE ("name", "type", "start_time", "end_time", "display_order", "updated_at") ON "timetable_periods" TO acadlyx_app;
-- period_type/start_time/end_time change only through the ON UPDATE CASCADE from the period.
GRANT UPDATE ("weekday", "period_id", "period_type", "start_time", "end_time", "subject_id", "teacher_id", "updated_at")
  ON "timetable_entries" TO acadlyx_app;
GRANT DELETE ON "homework", "assignments", "timetable_periods", "timetable_entries" TO acadlyx_app;
