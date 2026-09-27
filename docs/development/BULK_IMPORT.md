# Bulk import (Phase 5)

## Flow

1. **Download a template** (Students, Parents, Teachers; CSV or XLSX; `TEMPLATE_VERSION = 1`).
   The Students template has placement columns (`branch_code`, `academic_year`, `grade_code`,
   `section_code`) and `guardian1_*` / `guardian2_*` columns (`parent_code`, `relationship`,
   `primary`, `pickup`). **Import parents first**: students match guardians only by `parent_code`.
2. **Upload.** The file is parsed in memory and then discarded; only a SHA-256 hash and the
   normalised rows are stored.
   - Limits: 5 MB and 5,000 data rows.
   - CSV is strict UTF-8 (a BOM is allowed). Headers must match the template exactly (any order,
     case-insensitive); unknown or missing headers reject the upload.
   - XLSX: only the first sheet is read. Formula cells fail the row (`FORMULA_NOT_ALLOWED`).
     Before the workbook is loaded, the ZIP central directory is checked (≤ 2,000 entries,
     ≤ 60 MB uncompressed) as a zip-bomb guard.
3. **Preview.** Every row is validated before anything is created. Checks:
   - Field rules: the shared zod schemas, plus Phase 3 email/phone normalisation.
   - References, resolved only inside the current school: sections via codes, which must be
     active and not in a CLOSED year; guardians via `parent_code`, which must exist and be active.
   - Duplicates, whether already in the school (`DUPLICATE_EXISTING`) or earlier in the file
     (`DUPLICATE_IN_FILE`). Existing records are never updated.

   The job is `READY` with `validRows` / `invalidRows`. Row errors are listed in the UI and
   available as `errors.csv`.

4. **Confirm.** A conditional `READY → QUEUED` update prevents double submits, and then the job is
   enqueued on `bulk-import` with the payload `{importJobId, tenantId}`. If Redis is unavailable,
   the job goes back to `READY` and the API returns `503 IMPORT_QUEUE_UNAVAILABLE`.
5. **Process** (worker, concurrency 2):
   - The worker re-resolves the tenant by id. It must still be ACTIVE; otherwise the job fails
     without a retry.
   - It runs inside `TenantContext.run` with `TenantPrismaService`, so RLS applies. The worker
     never uses the platform client.
   - A job that is not visible under that tenant's RLS causes an `UnrecoverableError`.
   - Rows are processed in batches of 100 under a `FOR UPDATE` lock on the job. Each row runs in
     a SAVEPOINT, so a failing row (for example, a duplicate created meanwhile) is marked FAILED
     without affecting the others.
   - Row outcomes, counters and audit rows (actor = the uploading user, `importJobId` in metadata)
     are committed in the same transaction as the created records, so BullMQ retries are
     idempotent.
   - The row data of SUCCEEDED rows is cleared after processing.
6. **Result.** The job ends as `COMPLETED` (with succeeded/failed counts), or as `FAILED` once the
   retry attempts are exhausted. Rows already imported are kept.

## Policies

- Valid rows succeed independently of invalid ones.
- Imports never create login accounts. Use **Create account** on a profile afterwards.
- An import needs both `bulk_import.manage` and `<type>.manage`.
- Cancelling a READY job clears its stored row data.

## Local development

The worker runs inside the API process, so start the API with Redis available. Jobs stay
`QUEUED` until a worker picks them up. Tests: `apps/backend/test/imports.e2e-spec.ts` and
`apps/school-admin/test/people.e2e.test.ts`.
