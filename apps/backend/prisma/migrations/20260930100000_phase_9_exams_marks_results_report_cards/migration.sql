-- Phase 9: exams, marks, results & report cards; assignment grading (decisions A–V).
-- Official numbers are NUMERIC (no floating point). Tenant + school pinned by composite FKs; FORCE RLS.

-- CreateEnum
CREATE TYPE "exam_status" AS ENUM ('DRAFT', 'PUBLISHED', 'MARKS_ENTRY', 'MARKS_FINALIZED', 'RESULTS_PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "mark_sheet_status" AS ENUM ('DRAFT', 'SUBMITTED', 'FINALIZED', 'REOPENED');

-- CreateEnum
CREATE TYPE "mark_status" AS ENUM ('MARKED', 'ABSENT', 'EXEMPT');

-- CreateEnum
CREATE TYPE "result_outcome" AS ENUM ('PASS', 'FAIL', 'EXEMPT');

-- CreateEnum
CREATE TYPE "grade_release_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "max_marks" DECIMAL(7,2);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "grade_scale_id" UUID NOT NULL,
    "label" VARCHAR(10) NOT NULL,
    "min_percentage" DECIMAL(5,2) NOT NULL,
    "max_percentage" DECIMAL(5,2) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_scale_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "exam_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "pass_marks" DECIMAL(7,2),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "max_marks" DECIMAL(7,2) NOT NULL,
    "pass_marks" DECIMAL(7,2),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_component_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "exam_date" DATE NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_component_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_mark_sheets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" "mark_sheet_status" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "finalized_by_user_id" UUID,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exam_mark_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_mark_sheet_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "from_status" "mark_sheet_status" NOT NULL,
    "to_status" "mark_sheet_status" NOT NULL,
    "reason" VARCHAR(500),
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_mark_sheet_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_marks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "mark_status" NOT NULL,
    "marks_obtained" DECIMAL(7,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_exam_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_mark_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "mark_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "from_status" "mark_status",
    "from_marks" DECIMAL(7,2),
    "to_status" "mark_status" NOT NULL,
    "to_marks" DECIMAL(7,2),
    "reason" VARCHAR(500),
    "changed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_exam_mark_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exam_remarks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "remark" VARCHAR(500) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_exam_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_publications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "school_name" VARCHAR(160) NOT NULL,
    "exam_name" VARCHAR(100) NOT NULL,
    "academic_year_name" VARCHAR(40) NOT NULL,
    "published_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_student_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "student_name" VARCHAR(250) NOT NULL,
    "admission_number" VARCHAR(40) NOT NULL,
    "grade_name" VARCHAR(60) NOT NULL,
    "section_name" VARCHAR(40) NOT NULL,
    "total_obtained" DECIMAL(9,2) NOT NULL,
    "total_max" DECIMAL(9,2) NOT NULL,
    "percentage" DECIMAL(9,6),
    "grade_label" VARCHAR(10),
    "outcome" "result_outcome" NOT NULL,
    "remark" VARCHAR(500),

    CONSTRAINT "result_student_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_subject_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_snapshot_id" UUID NOT NULL,
    "subject_name" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "obtained" DECIMAL(9,2),
    "max_marks" DECIMAL(9,2),
    "pass_marks" DECIMAL(7,2),
    "percentage" DECIMAL(9,6),
    "grade_label" VARCHAR(10),
    "outcome" "result_outcome" NOT NULL,

    CONSTRAINT "result_subject_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_component_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "subject_snapshot_id" UUID NOT NULL,
    "component_name" VARCHAR(60) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "max_marks" DECIMAL(7,2) NOT NULL,
    "pass_marks" DECIMAL(7,2),
    "status" "mark_status" NOT NULL,
    "marks_obtained" DECIMAL(7,2),
    "passed" BOOLEAN,

    CONSTRAINT "result_component_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submission_grades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "submission_history_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "grade_release_status" NOT NULL DEFAULT 'DRAFT',
    "marks_awarded" DECIMAL(7,2),
    "feedback" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "graded_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_submission_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submission_grade_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "grade_release_status" NOT NULL,
    "marks_awarded" DECIMAL(7,2),
    "feedback" VARCHAR(2000),
    "changed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submission_grade_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_scales_tenant_id_school_id_academic_year_id_idx" ON "grade_scales"("tenant_id", "school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_id_school_id_tenant_id_key" ON "grade_scales"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_id_academic_year_id_school_id_tenant_id_key" ON "grade_scales"("id", "academic_year_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "grade_bands_tenant_id_idx" ON "grade_bands"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_grade_scale_id_display_order_key" ON "grade_bands"("grade_scale_id", "display_order");

-- CreateIndex
CREATE INDEX "exams_tenant_id_school_id_academic_year_id_status_idx" ON "exams"("tenant_id", "school_id", "academic_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exams_id_school_id_tenant_id_key" ON "exams"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exams_id_academic_year_id_school_id_tenant_id_key" ON "exams"("id", "academic_year_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_school_id_idx" ON "exam_subjects"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_exam_id_grade_id_subject_id_key" ON "exam_subjects"("exam_id", "grade_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_id_school_id_tenant_id_key" ON "exam_subjects"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_id_exam_id_grade_id_academic_year_id_school_i_key" ON "exam_subjects"("id", "exam_id", "grade_id", "academic_year_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_components_exam_subject_id_idx" ON "exam_components"("exam_subject_id");

-- CreateIndex
CREATE INDEX "exam_components_tenant_id_idx" ON "exam_components"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_components_id_school_id_tenant_id_key" ON "exam_components"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_components_id_exam_subject_id_school_id_tenant_id_key" ON "exam_components"("id", "exam_subject_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_components_id_exam_id_grade_id_school_id_tenant_id_key" ON "exam_components"("id", "exam_id", "grade_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_component_schedules_tenant_id_idx" ON "exam_component_schedules"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_component_schedules_component_id_branch_id_key" ON "exam_component_schedules"("component_id", "branch_id");

-- CreateIndex
CREATE INDEX "exam_mark_sheets_exam_id_section_id_idx" ON "exam_mark_sheets"("exam_id", "section_id");

-- CreateIndex
CREATE INDEX "exam_mark_sheets_tenant_id_idx" ON "exam_mark_sheets"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_mark_sheets_exam_subject_id_section_id_key" ON "exam_mark_sheets"("exam_subject_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_mark_sheets_id_school_id_tenant_id_key" ON "exam_mark_sheets"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_mark_sheets_id_exam_subject_id_school_id_tenant_id_key" ON "exam_mark_sheets"("id", "exam_subject_id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "exam_mark_sheet_events_sheet_id_created_at_idx" ON "exam_mark_sheet_events"("sheet_id", "created_at");

-- CreateIndex
CREATE INDEX "exam_mark_sheet_events_tenant_id_idx" ON "exam_mark_sheet_events"("tenant_id");

-- CreateIndex
CREATE INDEX "student_exam_marks_sheet_id_idx" ON "student_exam_marks"("sheet_id");

-- CreateIndex
CREATE INDEX "student_exam_marks_student_id_idx" ON "student_exam_marks"("student_id");

-- CreateIndex
CREATE INDEX "student_exam_marks_tenant_id_idx" ON "student_exam_marks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_marks_component_id_student_id_key" ON "student_exam_marks"("component_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_marks_id_school_id_tenant_id_key" ON "student_exam_marks"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "student_exam_mark_history_tenant_id_idx" ON "student_exam_mark_history"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_mark_history_mark_id_version_key" ON "student_exam_mark_history"("mark_id", "version");

-- CreateIndex
CREATE INDEX "student_exam_remarks_tenant_id_idx" ON "student_exam_remarks"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_remarks_exam_id_student_id_key" ON "student_exam_remarks"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "result_publications_tenant_id_idx" ON "result_publications"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_publications_exam_id_version_key" ON "result_publications"("exam_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "result_publications_id_school_id_tenant_id_key" ON "result_publications"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "result_student_snapshots_student_id_idx" ON "result_student_snapshots"("student_id");

-- CreateIndex
CREATE INDEX "result_student_snapshots_tenant_id_idx" ON "result_student_snapshots"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_student_snapshots_publication_id_student_id_key" ON "result_student_snapshots"("publication_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_student_snapshots_id_school_id_tenant_id_key" ON "result_student_snapshots"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "result_subject_snapshots_student_snapshot_id_idx" ON "result_subject_snapshots"("student_snapshot_id");

-- CreateIndex
CREATE INDEX "result_subject_snapshots_tenant_id_idx" ON "result_subject_snapshots"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_subject_snapshots_id_school_id_tenant_id_key" ON "result_subject_snapshots"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "result_component_snapshots_subject_snapshot_id_idx" ON "result_component_snapshots"("subject_snapshot_id");

-- CreateIndex
CREATE INDEX "result_component_snapshots_tenant_id_idx" ON "result_component_snapshots"("tenant_id");

-- CreateIndex
CREATE INDEX "assignment_submission_grades_assignment_id_idx" ON "assignment_submission_grades"("assignment_id");

-- CreateIndex
CREATE INDEX "assignment_submission_grades_student_id_idx" ON "assignment_submission_grades"("student_id");

-- CreateIndex
CREATE INDEX "assignment_submission_grades_tenant_id_idx" ON "assignment_submission_grades"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_grades_submission_history_id_key" ON "assignment_submission_grades"("submission_history_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_grades_id_school_id_tenant_id_key" ON "assignment_submission_grades"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "assignment_submission_grade_history_tenant_id_idx" ON "assignment_submission_grade_history"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_grade_history_grade_id_version_key" ON "assignment_submission_grade_history"("grade_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_history_id_submission_id_school_id_te_key" ON "assignment_submission_history"("id", "submission_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_id_assignment_id_student_id_school_i_key" ON "assignment_submissions"("id", "assignment_id", "student_id", "school_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_grade_id_academic_year_id_school_id_tenant_id_key" ON "sections"("id", "grade_id", "academic_year_id", "school_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "school_id", "tenant_id") REFERENCES "academic_years"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_grade_scale_id_school_id_tenant_id_fkey" FOREIGN KEY ("grade_scale_id", "school_id", "tenant_id") REFERENCES "grade_scales"("id", "school_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("academic_year_id", "school_id", "tenant_id") REFERENCES "academic_years"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_grade_scale_id_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("grade_scale_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "grade_scales"("id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_exam_id_academic_year_id_school_id_tenant_id_fkey" FOREIGN KEY ("exam_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "exams"("id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_grade_id_school_id_tenant_id_fkey" FOREIGN KEY ("grade_id", "school_id", "tenant_id") REFERENCES "grades"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("subject_id", "school_id", "tenant_id") REFERENCES "subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_exam_subject_id_school_id_tenant_id_fkey" FOREIGN KEY ("exam_subject_id", "school_id", "tenant_id") REFERENCES "exam_subjects"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_schedules" ADD CONSTRAINT "exam_component_schedules_component_id_exam_id_grade_id_sch_fkey" FOREIGN KEY ("component_id", "exam_id", "grade_id", "school_id", "tenant_id") REFERENCES "exam_components"("id", "exam_id", "grade_id", "school_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_schedules" ADD CONSTRAINT "exam_component_schedules_branch_id_school_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "school_id", "tenant_id") REFERENCES "branches"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT "exam_mark_sheets_exam_subject_id_exam_id_grade_id_academic_fkey" FOREIGN KEY ("exam_subject_id", "exam_id", "grade_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "exam_subjects"("id", "exam_id", "grade_id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT "exam_mark_sheets_section_id_grade_id_academic_year_id_scho_fkey" FOREIGN KEY ("section_id", "grade_id", "academic_year_id", "school_id", "tenant_id") REFERENCES "sections"("id", "grade_id", "academic_year_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_mark_sheet_events" ADD CONSTRAINT "exam_mark_sheet_events_sheet_id_school_id_tenant_id_fkey" FOREIGN KEY ("sheet_id", "school_id", "tenant_id") REFERENCES "exam_mark_sheets"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_sheet_id_exam_subject_id_school_id_tena_fkey" FOREIGN KEY ("sheet_id", "exam_subject_id", "school_id", "tenant_id") REFERENCES "exam_mark_sheets"("id", "exam_subject_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_component_id_exam_subject_id_school_id__fkey" FOREIGN KEY ("component_id", "exam_subject_id", "school_id", "tenant_id") REFERENCES "exam_components"("id", "exam_subject_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_mark_history" ADD CONSTRAINT "student_exam_mark_history_mark_id_school_id_tenant_id_fkey" FOREIGN KEY ("mark_id", "school_id", "tenant_id") REFERENCES "student_exam_marks"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_remarks" ADD CONSTRAINT "student_exam_remarks_exam_id_school_id_tenant_id_fkey" FOREIGN KEY ("exam_id", "school_id", "tenant_id") REFERENCES "exams"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_remarks" ADD CONSTRAINT "student_exam_remarks_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_exam_id_school_id_tenant_id_fkey" FOREIGN KEY ("exam_id", "school_id", "tenant_id") REFERENCES "exams"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_student_snapshots" ADD CONSTRAINT "result_student_snapshots_publication_id_school_id_tenant_i_fkey" FOREIGN KEY ("publication_id", "school_id", "tenant_id") REFERENCES "result_publications"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_student_snapshots" ADD CONSTRAINT "result_student_snapshots_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_subject_snapshots" ADD CONSTRAINT "result_subject_snapshots_student_snapshot_id_school_id_ten_fkey" FOREIGN KEY ("student_snapshot_id", "school_id", "tenant_id") REFERENCES "result_student_snapshots"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_component_snapshots" ADD CONSTRAINT "result_component_snapshots_subject_snapshot_id_school_id_t_fkey" FOREIGN KEY ("subject_snapshot_id", "school_id", "tenant_id") REFERENCES "result_subject_snapshots"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_grades" ADD CONSTRAINT "assignment_submission_grades_submission_history_id_submiss_fkey" FOREIGN KEY ("submission_history_id", "submission_id", "school_id", "tenant_id") REFERENCES "assignment_submission_history"("id", "submission_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_grades" ADD CONSTRAINT "assignment_submission_grades_submission_id_assignment_id_s_fkey" FOREIGN KEY ("submission_id", "assignment_id", "student_id", "school_id", "tenant_id") REFERENCES "assignment_submissions"("id", "assignment_id", "student_id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_grade_history" ADD CONSTRAINT "assignment_submission_grade_history_grade_id_school_id_ten_fkey" FOREIGN KEY ("grade_id", "school_id", "tenant_id") REFERENCES "assignment_submission_grades"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Integrity (CHECK / EXCLUDE / partial + expression uniques) ------------------------------
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_max_marks_positive" CHECK ("max_marks" IS NULL OR "max_marks" > 0);

ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_name_present" CHECK (btrim("name") <> '');
ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_version_positive" CHECK ("version" >= 1);
CREATE UNIQUE INDEX "grade_scales_school_year_name_key" ON "grade_scales" ("school_id", "academic_year_id", lower("name"));

-- Bands: min ≤ p < max (the band ending at 100 also holds exactly 100). No overlap is possible
-- (EXCLUDE on half-open ranges); full 0–100 coverage without gaps is validated when a scale is saved.
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_range_valid"
  CHECK ("min_percentage" >= 0 AND "max_percentage" <= 100 AND "min_percentage" < "max_percentage");
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_label_present" CHECK (btrim("label") <> '');
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_no_overlap"
  EXCLUDE USING gist ("grade_scale_id" WITH =, numrange("min_percentage", "max_percentage", '[)') WITH &&);
CREATE UNIQUE INDEX "grade_bands_scale_label_key" ON "grade_bands" ("grade_scale_id", lower("label"));

ALTER TABLE "exams" ADD CONSTRAINT "exams_name_present" CHECK (btrim("name") <> '');
ALTER TABLE "exams" ADD CONSTRAINT "exams_dates_ordered" CHECK ("end_date" >= "start_date");
ALTER TABLE "exams" ADD CONSTRAINT "exams_version_positive" CHECK ("version" >= 1);
ALTER TABLE "exams" ADD CONSTRAINT "exams_published_at_set" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL);
ALTER TABLE "exams" ADD CONSTRAINT "exams_archived_at_set" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
-- Case-insensitively unique per school + academic year (approved rule 9).
CREATE UNIQUE INDEX "exams_school_year_name_key" ON "exams" ("school_id", "academic_year_id", lower("name"));

ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_pass_marks_valid" CHECK ("pass_marks" IS NULL OR "pass_marks" >= 0);

ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_name_present" CHECK (btrim("name") <> '');
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_max_positive" CHECK ("max_marks" > 0);
ALTER TABLE "exam_components" ADD CONSTRAINT "exam_components_pass_valid"
  CHECK ("pass_marks" IS NULL OR ("pass_marks" >= 0 AND "pass_marks" <= "max_marks"));
CREATE UNIQUE INDEX "exam_components_subject_name_key" ON "exam_components" ("exam_subject_id", lower("name"));

ALTER TABLE "exam_component_schedules" ADD CONSTRAINT "exam_component_schedules_times_ordered" CHECK ("end_time" > "start_time");
-- One cohort (exam + grade + branch) is never booked into two overlapping papers (decision E).
ALTER TABLE "exam_component_schedules" ADD CONSTRAINT "exam_component_schedules_no_overlap"
  EXCLUDE USING gist ("exam_id" WITH =, "grade_id" WITH =, "branch_id" WITH =,
    tsrange("exam_date" + "start_time", "exam_date" + "end_time") WITH &&);

ALTER TABLE "exam_mark_sheets" ADD CONSTRAINT "exam_mark_sheets_version_positive" CHECK ("version" >= 1);
ALTER TABLE "exam_mark_sheet_events" ADD CONSTRAINT "exam_mark_sheet_events_reopen_reason"
  CHECK ("to_status" <> 'REOPENED' OR ("reason" IS NOT NULL AND char_length(btrim("reason")) BETWEEN 3 AND 500));

ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_state_value"
  CHECK (("status" = 'MARKED') = ("marks_obtained" IS NOT NULL));
ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_non_negative" CHECK ("marks_obtained" IS NULL OR "marks_obtained" >= 0);
ALTER TABLE "student_exam_marks" ADD CONSTRAINT "student_exam_marks_version_positive" CHECK ("version" >= 1);
ALTER TABLE "student_exam_mark_history" ADD CONSTRAINT "student_exam_mark_history_state_value"
  CHECK (("to_status" = 'MARKED') = ("to_marks" IS NOT NULL) AND ("to_marks" IS NULL OR "to_marks" >= 0));

ALTER TABLE "student_exam_remarks" ADD CONSTRAINT "student_exam_remarks_present" CHECK (btrim("remark") <> '');
ALTER TABLE "student_exam_remarks" ADD CONSTRAINT "student_exam_remarks_version_positive" CHECK ("version" >= 1);

ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_version_positive" CHECK ("version" >= 1);
-- At most one current publication version per exam.
CREATE UNIQUE INDEX "result_publications_one_current" ON "result_publications" ("exam_id") WHERE "is_current";

ALTER TABLE "assignment_submission_grades" ADD CONSTRAINT "assignment_submission_grades_marks_non_negative"
  CHECK ("marks_awarded" IS NULL OR "marks_awarded" >= 0);
ALTER TABLE "assignment_submission_grades" ADD CONSTRAINT "assignment_submission_grades_version_positive" CHECK ("version" >= 1);
ALTER TABLE "assignment_submission_grades" ADD CONSTRAINT "assignment_submission_grades_published_at_set"
  CHECK (("status" = 'PUBLISHED') = ("published_at" IS NOT NULL));

-- ---- Triggers: marks can never exceed the configured maximum --------------------------------
CREATE FUNCTION acadlyx_check_exam_mark_max() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE max_allowed NUMERIC;
BEGIN
  IF NEW.marks_obtained IS NULL THEN RETURN NEW; END IF;
  SELECT max_marks INTO max_allowed FROM exam_components WHERE id = NEW.component_id;
  IF max_allowed IS NULL OR NEW.marks_obtained > max_allowed THEN
    RAISE EXCEPTION 'marks exceed component maximum' USING ERRCODE = '23514', CONSTRAINT = 'student_exam_marks_within_max';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "student_exam_marks_within_max" BEFORE INSERT OR UPDATE OF "marks_obtained", "component_id"
  ON "student_exam_marks" FOR EACH ROW EXECUTE FUNCTION acadlyx_check_exam_mark_max();

-- A component maximum may not drop below marks already entered against it.
CREATE FUNCTION acadlyx_check_component_max() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM student_exam_marks WHERE component_id = NEW.id AND marks_obtained > NEW.max_marks) THEN
    RAISE EXCEPTION 'existing marks exceed new maximum' USING ERRCODE = '23514', CONSTRAINT = 'student_exam_marks_within_max';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "exam_components_max_covers_marks" BEFORE UPDATE OF "max_marks" ON "exam_components"
  FOR EACH ROW EXECUTE FUNCTION acadlyx_check_component_max();

-- Assignment grades: marks only when the assignment has a max_marks, and never above it.
CREATE FUNCTION acadlyx_check_assignment_grade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE max_allowed NUMERIC;
BEGIN
  SELECT max_marks INTO max_allowed FROM assignments WHERE id = NEW.assignment_id;
  IF NEW.marks_awarded IS NOT NULL AND (max_allowed IS NULL OR NEW.marks_awarded > max_allowed) THEN
    RAISE EXCEPTION 'grade marks outside the assignment maximum' USING ERRCODE = '23514', CONSTRAINT = 'assignment_submission_grades_within_max';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "assignment_submission_grades_within_max" BEFORE INSERT OR UPDATE OF "marks_awarded"
  ON "assignment_submission_grades" FOR EACH ROW EXECUTE FUNCTION acadlyx_check_assignment_grade();

-- ---- Row-level security ----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['grade_scales','grade_bands','exams','exam_subjects','exam_components',
    'exam_component_schedules','exam_mark_sheets','exam_mark_sheet_events','student_exam_marks',
    'student_exam_mark_history','student_exam_remarks','result_publications','result_student_snapshots',
    'result_subject_snapshots','result_component_snapshots','assignment_submission_grades',
    'assignment_submission_grade_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO acadlyx_app USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id())', t);
  END LOOP;
END $$;
-- Only a DRAFT exam may ever be deleted (and only while nothing references it).
CREATE POLICY "draft_only_delete" ON "exams" AS RESTRICTIVE FOR DELETE TO acadlyx_app USING ("status" = 'DRAFT');

-- ---- Grants (least privilege) ------------------------------------------------------------------
GRANT SELECT, INSERT ON "grade_scales", "grade_bands", "exams", "exam_subjects", "exam_components",
  "exam_component_schedules", "exam_mark_sheets", "exam_mark_sheet_events", "student_exam_marks",
  "student_exam_mark_history", "student_exam_remarks", "result_publications", "result_student_snapshots",
  "result_subject_snapshots", "result_component_snapshots", "assignment_submission_grades",
  "assignment_submission_grade_history" TO acadlyx_app;
-- Configuration (editable only while the exam allows it — service rules).
GRANT UPDATE ("name", "version", "updated_at") ON "grade_scales" TO acadlyx_app;
GRANT DELETE ON "grade_scales", "grade_bands" TO acadlyx_app;
GRANT UPDATE ("grade_scale_id", "name", "description", "start_date", "end_date", "status", "version",
  "published_at", "archived_at", "updated_at") ON "exams" TO acadlyx_app;
GRANT UPDATE ("pass_marks", "display_order", "updated_at") ON "exam_subjects" TO acadlyx_app;
GRANT UPDATE ("name", "max_marks", "pass_marks", "display_order", "updated_at") ON "exam_components" TO acadlyx_app;
GRANT UPDATE ("exam_date", "start_time", "end_time", "updated_at") ON "exam_component_schedules" TO acadlyx_app;
GRANT DELETE ON "exams", "exam_subjects", "exam_components", "exam_component_schedules" TO acadlyx_app;
-- Workflow + current marks: never deleted; identity/scope columns never updatable.
GRANT UPDATE ("status", "version", "submitted_by_user_id", "submitted_at", "finalized_by_user_id",
  "finalized_at", "updated_at") ON "exam_mark_sheets" TO acadlyx_app;
GRANT UPDATE ("status", "marks_obtained", "version", "updated_by_user_id", "updated_at") ON "student_exam_marks" TO acadlyx_app;
GRANT UPDATE ("remark", "version", "updated_by_user_id", "updated_at") ON "student_exam_remarks" TO acadlyx_app;
GRANT DELETE ON "student_exam_remarks" TO acadlyx_app;
-- Publications: only the "current" flag ever changes; snapshots and all history are append-only.
GRANT UPDATE ("is_current") ON "result_publications" TO acadlyx_app;
GRANT UPDATE ("status", "marks_awarded", "feedback", "version", "graded_by_user_id", "published_at", "updated_at")
  ON "assignment_submission_grades" TO acadlyx_app;
GRANT UPDATE ("max_marks") ON "assignments" TO acadlyx_app;
