-- Phase 8: assignment submissions (decisions D–L). Text + optional HTTPS link, no files, no grades.
-- One current row per assignment + student; every accepted version is appended to history.

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "text_content" VARCHAR(5000),
    "external_url" VARCHAR(2048),
    "version" INTEGER NOT NULL DEFAULT 1,
    "first_submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "last_submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submission_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text_content" VARCHAR(5000),
    "external_url" VARCHAR(2048),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submission_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_submissions_student_id_idx" ON "assignment_submissions"("student_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_tenant_id_school_id_idx" ON "assignment_submissions"("tenant_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_key" ON "assignment_submissions"("assignment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_id_school_id_tenant_id_key" ON "assignment_submissions"("id", "school_id", "tenant_id");

-- CreateIndex
CREATE INDEX "assignment_submission_history_tenant_id_idx" ON "assignment_submission_history"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submission_history_submission_id_version_key" ON "assignment_submission_history"("submission_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_id_school_id_tenant_id_key" ON "assignments"("id", "school_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_school_id_tenant_id_fkey" FOREIGN KEY ("assignment_id", "school_id", "tenant_id") REFERENCES "assignments"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_school_id_tenant_id_fkey" FOREIGN KEY ("student_id", "school_id", "tenant_id") REFERENCES "students"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submission_history" ADD CONSTRAINT "assignment_submission_history_submission_id_school_id_tena_fkey" FOREIGN KEY ("submission_id", "school_id", "tenant_id") REFERENCES "assignment_submissions"("id", "school_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Integrity -------------------------------------------------------------------------------
-- At least one of text / link (decision L); text never blank; link HTTPS only (no http:, javascript:,
-- data:, file:, ftp:); versions positive; last submission never before the first.
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_content_present"
  CHECK (("text_content" IS NOT NULL AND btrim("text_content") <> '') OR "external_url" IS NOT NULL);
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_text_not_blank"
  CHECK ("text_content" IS NULL OR btrim("text_content") <> '');
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_url_https"
  CHECK ("external_url" IS NULL OR "external_url" ~ '^https://[^[:space:]]+$');
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_version_positive" CHECK ("version" >= 1);
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_times_ordered"
  CHECK ("last_submitted_at" >= "first_submitted_at");

ALTER TABLE "assignment_submission_history" ADD CONSTRAINT "assignment_submission_history_content_present"
  CHECK (("text_content" IS NOT NULL AND btrim("text_content") <> '') OR "external_url" IS NOT NULL);
ALTER TABLE "assignment_submission_history" ADD CONSTRAINT "assignment_submission_history_text_not_blank"
  CHECK ("text_content" IS NULL OR btrim("text_content") <> '');
ALTER TABLE "assignment_submission_history" ADD CONSTRAINT "assignment_submission_history_url_https"
  CHECK ("external_url" IS NULL OR "external_url" ~ '^https://[^[:space:]]+$');
ALTER TABLE "assignment_submission_history" ADD CONSTRAINT "assignment_submission_history_version_positive" CHECK ("version" >= 1);

-- ---- Row-level security ----------------------------------------------------------------------
ALTER TABLE "assignment_submissions" ENABLE ROW LEVEL SECURITY;        ALTER TABLE "assignment_submissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submission_history" ENABLE ROW LEVEL SECURITY; ALTER TABLE "assignment_submission_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "assignment_submissions" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY "tenant_isolation" ON "assignment_submission_history" FOR ALL TO acadlyx_app
  USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- ---- Grants (least privilege) ------------------------------------------------------------------
-- Submissions are never deleted; only content/version/time change. History is append-only.
GRANT SELECT, INSERT ON "assignment_submissions", "assignment_submission_history" TO acadlyx_app;
GRANT UPDATE ("text_content", "external_url", "version", "last_submitted_at", "updated_at")
  ON "assignment_submissions" TO acadlyx_app;
