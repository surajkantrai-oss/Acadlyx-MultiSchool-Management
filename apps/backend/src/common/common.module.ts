import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuditService } from './audit/audit.service.js';

@Global()
@Module({
  imports: [DatabaseModule, TenancyModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class CommonModule {}
