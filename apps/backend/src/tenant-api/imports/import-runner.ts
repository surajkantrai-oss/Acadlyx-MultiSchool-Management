import type { ImportRowError } from '@acadlyx/types';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { AuditEvent } from '../../common/audit/audit.service.js';
import type {
  BulkImportJob,
  BulkImportRow,
  Prisma,
  School,
} from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore, fromIsoDate } from '../academic/academic-store.js';
import { ParentsService } from '../people/parents.service.js';
import { PEOPLE_ERRORS } from '../people/people-errors.js';
import { StudentsService } from '../people/students.service.js';
import { TeachersService } from '../people/teachers.service.js';
import type { RowData } from './import-validator.js';

const BATCH_SIZE = 100;

/**
 * Executes a CONFIRMED import inside the tenant context the worker established (TenantPrisma →
 * FORCE RLS; never the platform client). Idempotent under BullMQ retries:
 *  - only rows still VALID are processed; each row's outcome (SUCCEEDED/FAILED + entity id) and
 *    the job counters are committed in the SAME transaction as the created records;
 *  - each row runs inside a SAVEPOINT, so one bad row never rolls back the others;
 *  - a crash mid-batch rolls the whole batch back, and the retry re-processes exactly those rows.
 * Business problems fail the ROW (reported), never the BullMQ job; infrastructure errors throw
 * and are retried with bounded attempts.
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger('BulkImport');

  constructor(
    private readonly store: AcademicStore,
    private readonly students: StudentsService,
    private readonly parents: ParentsService,
    private readonly teachers: TeachersService,
  ) {}

  async run(importJobId: string): Promise<void> {
    const job = await this.store.run((tx) =>
      tx.bulkImportJob.findFirst({ where: { id: importJobId } }),
    );
    // Invisible under this tenant's RLS = wrong tenant (or gone): never process, never retry.
    if (!job)
      throw new UnrecoverableError('Import job is not visible in the worker tenant context');
    if (job.status !== 'QUEUED' && job.status !== 'PROCESSING') {
      this.logger.log({ importJobId, status: job.status }, 'import not runnable; skipping');
      return;
    }
    if (job.status === 'QUEUED') {
      await this.store.run(async (tx) => {
        const started = await tx.bulkImportJob.updateMany({
          where: { id: job.id, status: 'QUEUED' },
          data: { status: 'PROCESSING', startedAt: new Date() },
        });
        if (started.count === 1)
          await audit(tx, job, [
            { action: 'IMPORT_STARTED', resourceType: 'bulk_import', resourceId: job.id },
          ]);
      });
    }
    for (;;) {
      const processed = await this.store.run(async (tx) => {
        const school = await this.store.school(tx);
        // Serialise concurrent runs of the same import (e.g. BullMQ stalled-job recovery):
        // the second run waits here, then sees the rows the first one already finished.
        await tx.$queryRaw`SELECT "id" FROM "bulk_import_jobs" WHERE "id" = ${job.id}::uuid FOR UPDATE`;
        const rows = await tx.bulkImportRow.findMany({
          where: { jobId: job.id, status: 'VALID' },
          orderBy: { rowNumber: 'asc' },
          take: BATCH_SIZE,
        });
        let succeeded = 0;
        let failed = 0;
        const events: AuditEvent[] = [];
        for (const row of rows) {
          await tx.$executeRawUnsafe('SAVEPOINT import_row');
          const rowEvents: AuditEvent[] = [];
          try {
            const entityId = await this.processRow(tx, school, job, row, rowEvents);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
            await tx.bulkImportRow.update({
              where: { id: row.id },
              data: { status: 'SUCCEEDED', entityId, processedAt: new Date(), data: {} },
            });
            events.push(...rowEvents);
            succeeded += 1;
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
            const rowError = toRowError(error);
            if (!rowError) throw error; // infrastructure problem → whole batch retried
            await tx.bulkImportRow.update({
              where: { id: row.id },
              data: {
                status: 'FAILED',
                processedAt: new Date(),
                errors: [rowError] as unknown as Prisma.InputJsonValue,
              },
            });
            failed += 1;
          }
        }
        if (rows.length > 0) {
          await tx.bulkImportJob.update({
            where: { id: job.id },
            data: {
              processedRows: { increment: rows.length },
              succeededRows: { increment: succeeded },
              failedRows: { increment: failed },
            },
          });
          await audit(tx, job, events);
        }
        return rows.length;
      });
      if (processed < BATCH_SIZE) break;
    }
    await this.store.run(async (tx) => {
      const done = await tx.bulkImportJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (done.count === 1) {
        const final = await tx.bulkImportJob.findFirstOrThrow({ where: { id: job.id } });
        await audit(tx, job, [
          {
            action: 'IMPORT_COMPLETED',
            resourceType: 'bulk_import',
            resourceId: job.id,
            metadata: { succeeded: final.succeededRows, failed: final.failedRows, type: job.type },
          },
        ]);
      }
    });
  }

  /** Marks a job FAILED after BullMQ exhausted its retries (generic reason, no raw errors). */
  async markFailed(importJobId: string): Promise<void> {
    await this.store.run(async (tx) => {
      const job = await tx.bulkImportJob.findFirst({ where: { id: importJobId } });
      if (!job) return;
      const res = await tx.bulkImportJob.updateMany({
        where: { id: job.id, status: { in: ['QUEUED', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          failureReason:
            'Processing stopped after repeated system errors. Rows already imported were kept.',
        },
      });
      if (res.count === 1)
        await audit(tx, job, [
          { action: 'IMPORT_FAILED', resourceType: 'bulk_import', resourceId: job.id },
        ]);
    });
  }

  private async processRow(
    tx: TenantTransaction,
    school: School,
    job: BulkImportJob,
    row: BulkImportRow,
    events: AuditEvent[],
  ): Promise<string> {
    const d = (row.data ?? {}) as RowData;
    const meta = { importJobId: job.id, rowNumber: row.rowNumber };
    if (job.type === 'PARENTS') {
      const id = await this.parents.createIn(tx, school, {
        parentCode: d.parent_code ?? null,
        firstName: d.first_name ?? '',
        middleName: d.middle_name ?? null,
        lastName: d.last_name ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
      });
      events.push({
        action: 'PARENT_CREATED',
        resourceType: 'parent',
        resourceId: id,
        metadata: meta,
      });
      return id;
    }
    if (job.type === 'TEACHERS') {
      const id = await this.teachers.createIn(tx, school, {
        employeeId: d.employee_id ?? '',
        firstName: d.first_name ?? '',
        middleName: d.middle_name ?? null,
        lastName: d.last_name ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        joiningDate: d.joining_date ?? null,
      });
      events.push({
        action: 'TEACHER_CREATED',
        resourceType: 'teacher',
        resourceId: id,
        metadata: meta,
      });
      return id;
    }
    // STUDENTS — re-checked now (data may have changed since validation).
    const admissionNumber = d.admission_number ?? '';
    if (await tx.student.findFirst({ where: { schoolId: school.id, admissionNumber } }))
      throw PEOPLE_ERRORS.duplicateAdmissionNumber();
    const student = await tx.student.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        admissionNumber,
        firstName: d.first_name ?? '',
        middleName: d.middle_name ?? null,
        lastName: d.last_name ?? null,
        preferredName: d.preferred_name ?? null,
        dateOfBirth: d.date_of_birth ? fromIsoDate(d.date_of_birth) : null,
        admissionDate: d.admission_date ? fromIsoDate(d.admission_date) : null,
      },
    });
    await tx.studentStatusHistory.create({
      data: {
        tenantId: school.tenantId,
        schoolId: school.id,
        studentId: student.id,
        toStatus: 'ACTIVE',
        reason: 'Imported',
        changedByUserId: job.createdByUserId,
      },
    });
    events.push({
      action: 'STUDENT_CREATED',
      resourceType: 'student',
      resourceId: student.id,
      metadata: meta,
    });
    if (d.section_id)
      await this.students.enrollIn(tx, school, student.id, d.section_id, undefined, events);
    for (const n of ['1', '2']) {
      const code = d[`guardian${n}_parent_code`];
      if (!code) continue;
      const parent = await tx.parent.findFirst({
        where: { schoolId: school.id, parentCode: code },
      });
      if (!parent) throw PEOPLE_ERRORS.parentNotFound();
      await this.students.linkIn(
        tx,
        school,
        student.id,
        {
          parentId: parent.id,
          relationship: (d[`guardian${n}_relationship`] ?? 'GUARDIAN') as 'GUARDIAN',
          isPrimary: d[`guardian${n}_primary`] === 'yes',
          pickupAuthorized: d[`guardian${n}_pickup`] === 'yes',
        },
        events,
      );
    }
    return student.id;
  }
}

/** Domain (HttpException) and constraint problems fail the row; anything else is infrastructure. */
function toRowError(error: unknown): ImportRowError | null {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: string; message?: string | string[] };
    const message = Array.isArray(body.message)
      ? body.message.join('; ')
      : (body.message ?? 'Row could not be imported');
    return { field: '*', code: body.code ?? 'ROW_REJECTED', message };
  }
  const code = (error as { code?: string }).code;
  if (code === 'P2002' || code === 'P2003' || code === 'P2004')
    return {
      field: '*',
      code: 'CONFLICT',
      message: 'The row conflicts with existing data (it may have been created meanwhile)',
    };
  return null;
}

/**
 * Audit rows written in the SAME transaction as the imported records (so they exist only if the
 * batch committed). Actor = the user who uploaded/confirmed the import; importJobId in metadata.
 */
async function audit(
  tx: TenantTransaction,
  job: BulkImportJob,
  events: AuditEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.auditLog.createMany({
    data: events.map((e) => ({
      tenantId: job.tenantId,
      actorUserId: job.createdByUserId,
      actorLabel: `user:${job.createdByUserId}`,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      changedFields: e.changedFields ?? [],
      metadata: { ...e.metadata, importJobId: job.id },
    })),
  });
}
