import { createHash } from 'node:crypto';
import type { Paginated } from '@acadlyx/tenant-config';
import type { ImportJob, ImportRow, ImportRowError, ImportType } from '@acadlyx/types';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import ExcelJS from 'exceljs';
import { currentAuth } from '../../auth/core/access.guard.js';
import { conflict } from '../../common/errors/domain-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import type { TenantTransaction } from '../../tenancy/tenant-prisma.service.js';
import { AcademicStore } from '../academic/academic-store.js';
import { PEOPLE_ERRORS } from '../people/people-errors.js';
import { paginated, paging } from '../people/people-mappers.js';
import { badRequest } from '../../common/errors/domain-errors.js';
import { parseUpload } from './import-parser.js';
import { checkHeaders, IMPORT_TEMPLATES, TEMPLATE_VERSION } from './import-templates.js';
import { validateRows } from './import-validator.js';

export const IMPORT_QUEUE = 'bulk-import';

/** Per import type, the profile permission needed IN ADDITION to bulk_import.manage. */
const TYPE_PERMISSION = {
  STUDENTS: 'student.manage',
  PARENTS: 'parent.manage',
  TEACHERS: 'teacher.manage',
} as const;

const QUEUE_TIMEOUT_MS = 5_000;

export interface ImportQueuePayload {
  importJobId: string;
  tenantId: string;
}

/**
 * Bulk onboarding: upload → parse → validate → preview (READY) → confirm (QUEUED) →
 * background processing (PROCESSING → COMPLETED/FAILED). Nothing is created before confirmation.
 * The original file is never stored — only normalised rows; succeeded rows' data is cleared.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly store: AcademicStore,
    @InjectQueue(IMPORT_QUEUE) private readonly queue: Queue<ImportQueuePayload>,
  ) {}

  async upload(
    type: ImportType,
    file: { originalname: string; buffer: Buffer } | undefined,
  ): Promise<ImportJob> {
    if (!currentAuth().permissions.includes(TYPE_PERMISSION[type]))
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to do this',
      });
    if (!file) throw badRequest('IMPORT_FILE_REQUIRED', 'Choose a file to upload');
    const parsed = await parseUpload(file.buffer, file.originalname);
    const headerProblems = checkHeaders(type, parsed.headers);
    if (headerProblems.length > 0) throw badRequest('IMPORT_HEADERS_INVALID', headerProblems);
    if (parsed.rows.length === 0) throw badRequest('IMPORT_EMPTY', 'The file has no data rows');
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const filename = file.originalname.replace(/[^\w .()-]/g, '_').slice(0, 200);

    return this.store.transact(async (tx, school, events) => {
      const rows = await validateRows(tx, school, type, parsed.rows);
      const valid = rows.filter((r) => r.valid).length;
      const job = await tx.bulkImportJob.create({
        data: {
          tenantId: school.tenantId,
          schoolId: school.id,
          type,
          status: 'READY',
          templateVersion: TEMPLATE_VERSION,
          originalFilename: filename,
          fileHash,
          totalRows: rows.length,
          validRows: valid,
          invalidRows: rows.length - valid,
          createdByUserId: actorUserId(),
        },
      });
      for (let i = 0; i < rows.length; i += 1_000) {
        await tx.bulkImportRow.createMany({
          data: rows.slice(i, i + 1_000).map((r) => ({
            tenantId: school.tenantId,
            schoolId: school.id,
            jobId: job.id,
            rowNumber: r.rowNumber,
            status: r.valid ? ('VALID' as const) : ('INVALID' as const),
            data: r.data,
            errors:
              r.errors.length > 0 ? (r.errors as unknown as Prisma.InputJsonValue) : undefined,
          })),
        });
      }
      events.push(
        {
          action: 'IMPORT_UPLOADED',
          resourceType: 'bulk_import',
          resourceId: job.id,
          metadata: { type, rows: rows.length },
        },
        {
          action: 'IMPORT_VALIDATED',
          resourceType: 'bulk_import',
          resourceId: job.id,
          metadata: { valid, invalid: rows.length - valid },
        },
      );
      return this.toJob(tx, job.id);
    });
  }

  list(query: { page?: number; pageSize?: number }): Promise<Paginated<ImportJob>> {
    const { page, pageSize, skip, take } = paging(query);
    return this.store.run(async (tx) => {
      const school = await this.store.school(tx);
      const where = { schoolId: school.id };
      const [total, jobs] = await Promise.all([
        tx.bulkImportJob.count({ where }),
        tx.bulkImportJob.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
        }),
      ]);
      const names = await this.creators(
        tx,
        jobs.map((j) => j.createdByUserId),
      );
      return paginated(
        jobs.map((j) => toJob(j, names)),
        total,
        page,
        pageSize,
      );
    });
  }

  get(id: string): Promise<ImportJob> {
    return this.store.run((tx) => this.toJob(tx, id));
  }

  rows(
    id: string,
    query: { status?: ImportRow['status']; page?: number; pageSize?: number },
  ): Promise<Paginated<ImportRow>> {
    const { page, pageSize, skip, take } = paging({
      page: query.page,
      pageSize: query.pageSize ?? 50,
    });
    return this.store.run(async (tx) => {
      await this.find(tx, id);
      const where = { jobId: id, ...(query.status ? { status: query.status } : {}) };
      const [total, rows] = await Promise.all([
        tx.bulkImportRow.count({ where }),
        tx.bulkImportRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip, take }),
      ]);
      return paginated(
        rows.map((r) => ({
          rowNumber: r.rowNumber,
          status: r.status,
          data: (r.data as Record<string, string | null> | null) ?? null,
          errors: (r.errors as ImportRowError[] | null) ?? [],
          entityId: r.entityId,
        })),
        total,
        page,
        pageSize,
      );
    });
  }

  /** Row-level error report (INVALID + FAILED rows). Cells are neutralised against CSV formula injection. */
  errorsCsv(id: string): Promise<{ filename: string; body: string }> {
    return this.store.run(async (tx) => {
      const job = await this.find(tx, id);
      const rows = await tx.bulkImportRow.findMany({
        where: { jobId: id, status: { in: ['INVALID', 'FAILED'] } },
        orderBy: { rowNumber: 'asc' },
      });
      const lines = [['row_number', 'status', 'field', 'code', 'message']];
      for (const r of rows)
        for (const e of (r.errors as ImportRowError[] | null) ?? [])
          lines.push([String(r.rowNumber), r.status, e.field, e.code, e.message]);
      return {
        filename: `import-${job.type.toLowerCase()}-${job.id.slice(0, 8)}-errors.csv`,
        body: `${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`,
      };
    });
  }

  /**
   * READY → QUEUED exactly once (conditional update — double clicks / concurrent confirms lose),
   * then enqueue {importJobId, tenantId} only. If Redis/BullMQ is unavailable the job goes back
   * to READY and the caller gets 503 — it is never marked as processing, and no data changed.
   */
  async confirm(id: string): Promise<ImportJob> {
    const job = await this.store.transact(async (tx, _school, events) => {
      const existing = await this.find(tx, id);
      if (existing.validRows === 0)
        throw conflict('IMPORT_NOTHING_TO_IMPORT', 'The import has no valid rows');
      const now = new Date();
      const won = await tx.bulkImportJob.updateMany({
        where: { id, status: 'READY' },
        data: { status: 'QUEUED', confirmedAt: now },
      });
      if (won.count !== 1)
        throw conflict('IMPORT_NOT_READY', 'The import has already been confirmed or cancelled');
      events.push({
        action: 'IMPORT_CONFIRMED',
        resourceType: 'bulk_import',
        resourceId: id,
        metadata: { validRows: existing.validRows },
      });
      return { ...existing, confirmedAt: now };
    });
    const tenantId = TenantContext.getTenantId();
    try {
      await withTimeout(
        this.queue.add(
          'process',
          { importJobId: id, tenantId },
          { jobId: `import-${id}-${String(job.confirmedAt.getTime())}` },
        ),
        QUEUE_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.error(
        `Import ${id}: enqueue failed (${(error as Error).message}); reverting to READY`,
      );
      await this.store.run((tx) =>
        tx.bulkImportJob.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'READY', confirmedAt: null },
        }),
      );
      throw new ServiceUnavailableException({
        code: 'IMPORT_QUEUE_UNAVAILABLE',
        message:
          'Background processing is unavailable right now. Nothing was imported — please try again shortly.',
      });
    }
    return this.get(id);
  }

  cancel(id: string): Promise<ImportJob> {
    return this.store.transact(async (tx, _school, events) => {
      await this.find(tx, id);
      const won = await tx.bulkImportJob.updateMany({
        where: { id, status: 'READY' },
        data: { status: 'CANCELLED' },
      });
      if (won.count !== 1)
        throw conflict('IMPORT_NOT_READY', 'Only an import awaiting confirmation can be cancelled');
      // Data minimisation: a cancelled preview keeps counts/errors, not the personal data.
      await tx.bulkImportRow.updateMany({ where: { jobId: id }, data: { data: {} } });
      events.push({ action: 'IMPORT_CANCELLED', resourceType: 'bulk_import', resourceId: id });
      return this.toJob(tx, id);
    });
  }

  /** Template file generated from the same column definitions the validator uses. */
  async templateFile(
    type: ImportType,
    format: 'csv' | 'xlsx',
  ): Promise<{ filename: string; body: Buffer; contentType: string }> {
    const columns = IMPORT_TEMPLATES[type];
    const base = `acadlyx-${type.toLowerCase()}-template-v${String(TEMPLATE_VERSION)}`;
    if (format === 'csv') {
      return {
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(`${columns.map((c) => csvCell(c.name)).join(',')}\r\n`, 'utf8'),
      };
    }
    const wb = new ExcelJS.Workbook();
    const data = wb.addWorksheet('Data');
    data.addRow(columns.map((c) => c.name));
    data.getRow(1).font = { bold: true };
    data.columns.forEach((c) => {
      c.width = 20;
    });
    const help = wb.addWorksheet('Instructions');
    help.addRow([
      `Acadlyx ${type.toLowerCase()} import — template version ${String(TEMPLATE_VERSION)}`,
    ]);
    help.addRow([
      'Fill the Data sheet (first sheet) only. Values only — formulas are rejected. Max 5,000 rows / 5 MB.',
    ]);
    help.addRow([]);
    help.addRow(['Column', 'Required', 'Description', 'Example']);
    for (const c of columns)
      help.addRow([c.name, c.required ? 'yes' : 'no', c.description, c.example]);
    help.getColumn(3).width = 70;
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(await wb.xlsx.writeBuffer()),
    };
  }

  private async find(tx: TenantTransaction, id: string) {
    const school = await this.store.school(tx);
    const job = await tx.bulkImportJob.findFirst({ where: { id, schoolId: school.id } });
    if (!job) throw PEOPLE_ERRORS.importNotFound();
    return job;
  }

  private async toJob(tx: TenantTransaction, id: string): Promise<ImportJob> {
    const job = await this.find(tx, id);
    return toJob(job, await this.creators(tx, [job.createdByUserId]));
  }

  private async creators(tx: TenantTransaction, ids: string[]): Promise<Map<string, string>> {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }
}

function toJob(j: Prisma.BulkImportJobGetPayload<object>, names: Map<string, string>): ImportJob {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    templateVersion: j.templateVersion,
    originalFilename: j.originalFilename,
    totalRows: j.totalRows,
    validRows: j.validRows,
    invalidRows: j.invalidRows,
    processedRows: j.processedRows,
    succeededRows: j.succeededRows,
    failedRows: j.failedRows,
    failureReason: j.failureReason,
    createdBy: { userId: j.createdByUserId, displayName: names.get(j.createdByUserId) ?? null },
    createdAt: j.createdAt.toISOString(),
    confirmedAt: j.confirmedAt?.toISOString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}

/** RFC 4180 quoting + formula-injection guard (=, +, -, @, tab, CR prefixed with '). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The authenticated tenant user (tenant routes only ever run with a TENANT identity). */
function actorUserId(): string {
  const auth = currentAuth();
  if (auth.scope !== 'TENANT')
    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to do this',
    });
  return auth.userId;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('queue timeout'));
      }, ms);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}
