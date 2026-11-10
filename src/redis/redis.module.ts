import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { REDIS_CLIENT, RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis | null => {
        if (!config.redisUrl) return null;
        const client = new Redis(config.redisUrl, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
        });
        const logger = new Logger('Redis');
        // ioredis emits an 'error' event on every failed (re)connection attempt. We do not
        // swallow it: it is logged, at most once a minute so an outage does not flood the logs.
        // Requests keep working meanwhile because RedisService falls back to in-memory state.
        let lastLoggedAt = 0;
        client.on('error', (error: Error) => {
          if (Date.now() - lastLoggedAt < 60_000) return;
          lastLoggedAt = Date.now();
          logger.warn(`Connection problem: ${error.message}`);
        });
        logger.log(`Connecting to ${new URL(config.redisUrl).host}`);
        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
