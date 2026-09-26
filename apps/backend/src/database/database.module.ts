import { Module } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service.js';

/** Platform database access. Deliberately NOT global: import it only where platform scope is intended. */
@Module({
  providers: [PlatformPrismaService],
  exports: [PlatformPrismaService],
})
export class DatabaseModule {}
