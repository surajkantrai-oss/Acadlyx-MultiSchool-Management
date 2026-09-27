import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { RedisService } from '../../cache/redis.service.js';
import { TenantResolverService } from '../../tenancy/tenant-resolver.service.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import { ImportRunner } from './import-runner.js';
import { IMPORT_QUEUE, type ImportQueuePayload } from './imports.service.js';

/**
 * BullMQ worker for confirmed imports (approved strategy P). The payload carries only
 * {importJobId, tenantId}. Before touching data the worker re-resolves the tenant by id (it must
 * still be ACTIVE) and runs everything inside TenantContext.run → TenantPrismaService →
 * FORCE RLS. A job id that is not visible under that tenant is rejected without retry.
 * Retries: bounded (queue defaults: 3 attempts, exponential backoff); after the last attempt the
 * import is marked FAILED.
 */
@Processor(IMPORT_QUEUE, { concurrency: 2 })
export class ImportProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger('BulkImportWorker');

  constructor(
    private readonly resolver: TenantResolverService,
    private readonly runner: ImportRunner,
    private readonly redis: RedisService,
  ) {
    super();
  }

  /**
   * Bounded shutdown. BullMQ's graceful close waits for the fetch loop, which never returns while
   * Redis is unreachable — so the app would hang on SIGTERM. With Redis up we close gracefully
   * (the active batch finishes); with Redis down we force-close. Forcing is safe: an interrupted
   * batch transaction rolls back and the retried job resumes idempotently from persisted rows.
   * Runs before @nestjs/bullmq's own shutdown, whose close() then returns this same promise.
   */
  async onModuleDestroy(): Promise<void> {
    let worker: WorkerHost['worker'];
    try {
      worker = this.worker;
    } catch {
      return; // module compiled but never initialised (no worker was started)
    }
    const redisUp = this.redis.client.status === 'ready';
    await worker.close(!redisUp).catch((error: unknown) => {
      this.logger.warn(`worker close: ${(error as Error).message}`);
    });
  }

  async process(job: Job<ImportQueuePayload>): Promise<void> {
    const { importJobId, tenantId } = job.data;
    await this.inTenant(tenantId, () => this.runner.run(importJobId));
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ImportQueuePayload> | undefined, error: Error): Promise<void> {
    if (!job) return;
    this.logger.error(
      { importJobId: job.data.importJobId, attempt: job.attemptsMade, error: error.name },
      'import attempt failed',
    );
    const exhausted =
      error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted || error instanceof UnrecoverableError) return;
    await this.inTenant(job.data.tenantId, () =>
      this.runner.markFailed(job.data.importJobId),
    ).catch(() => undefined);
  }

  private async inTenant(tenantId: string, fn: () => Promise<void>): Promise<void> {
    const tenant = await this.resolver.resolveById(tenantId);
    if (!tenant) throw new UnrecoverableError('Tenant of import job not found');
    if (tenant.status !== 'ACTIVE') throw new UnrecoverableError('Tenant is not active');
    await TenantContext.run({ outcome: 'resolved', tenant, source: 'tenant-key' }, fn);
  }
}
