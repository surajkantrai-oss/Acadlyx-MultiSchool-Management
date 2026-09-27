import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../../cache/redis.service.js';
import { AppConfigService } from '../../../config/app-config.service.js';
import { AUTH_ERROR_CODES } from '../auth-errors.js';

export interface OtpMessage {
  channel: 'SMS' | 'EMAIL';
  target: string;
  code: string;
  purpose: string;
  tenantKey: string;
}

/**
 * Delivery abstraction. No real SMS/email provider is integrated yet (a later decision):
 *   OTP_DELIVERY=dev  → development outbox in Redis (`dev:otp-outbox:<target>`, 15 min), never in
 *                       production (enforced by env validation). Codes are NOT written to logs.
 *   OTP_DELIVERY=none → fails closed with 503 OTP_DELIVERY_UNAVAILABLE; nothing pretends to send.
 */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);
  private readonly mode: 'dev' | 'none';

  constructor(
    config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    this.mode = config.get('OTP_DELIVERY');
  }

  get available(): boolean {
    return this.mode === 'dev';
  }

  assertAvailable(): void {
    if (!this.available) {
      throw new ServiceUnavailableException({
        code: AUTH_ERROR_CODES.OTP_DELIVERY_UNAVAILABLE,
        message: 'Verification codes cannot be sent right now',
      });
    }
  }

  async deliver(message: OtpMessage): Promise<void> {
    this.assertAvailable();
    const key = `dev:otp-outbox:${message.target}`;
    await this.redis.client
      .multi()
      .lpush(
        key,
        JSON.stringify({
          code: message.code,
          purpose: message.purpose,
          tenantKey: message.tenantKey,
          at: new Date().toISOString(),
        }),
      )
      .ltrim(key, 0, 9)
      .expire(key, 15 * 60)
      .exec();
    this.logger.log(`Development OTP stored in outbox (${message.channel}, ${message.purpose})`);
  }
}
