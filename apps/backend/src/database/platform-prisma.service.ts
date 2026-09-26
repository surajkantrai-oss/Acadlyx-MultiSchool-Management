import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * PLATFORM-scoped database access (role `acadlyx`, schema owner with BYPASSRLS).
 *
 * Sees every tenant's rows. Use it ONLY for Platform Admin operations and tenant resolution.
 * Tenant-scoped code must use TenantPrismaService instead; an ESLint rule forbids importing
 * this service from src/tenant-api.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformPrismaService.name);

  constructor(config: AppConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleInit(): Promise<void> {
    // Connect eagerly so a misconfigured database is visible at boot, but do not
    // crash: the health endpoint reports the dependency as down instead.
    try {
      await this.$connect();
      this.logger.log('PostgreSQL (platform) connection established');
    } catch (error) {
      this.logger.error(`PostgreSQL connection failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('PostgreSQL (platform) connection closed');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
