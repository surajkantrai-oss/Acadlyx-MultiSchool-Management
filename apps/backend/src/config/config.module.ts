import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service.js';
import { validateEnv } from './env.schema.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      // Tests inject their environment explicitly; everything else may use a local .env.
      ignoreEnvFile: process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
