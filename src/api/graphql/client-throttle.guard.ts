import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { createHash } from 'crypto';
import { ClientRateLimitedError } from '../../common/errors';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { RedisService } from '../../infrastructure/redis/redis.service';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/** Identifies an anonymous client by `x-api-key` when sent, otherwise by network address. */
export function clientId(req: RequestLike): string {
  const header = req.headers['x-api-key'];
  const apiKey = Array.isArray(header) ? header[0] : header;
  const raw = apiKey ? `key:${apiKey}` : `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
  // Hashed so raw API keys never end up in Redis key names.
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

/**
 * Fixed-window request limit per client, counted in Redis so it holds across instances.
 * Applies to the whole GraphQL resolver, whether or not the request reaches Open-Meteo.
 *
 * How it works: Nest runs `canActivate` before every resolver method. It finds the client (API key,
 * else IP), adds 1 to that client's counter in Redis (the counter lives for one window, 60 s by
 * default, started by the first request) and lets the request through while the counter is within
 * CLIENT_RATE_LIMIT (60). Beyond that it throws an error saying how many seconds are left in the
 * window, and the resolver is not called.
 *
 * Custom instead of @nestjs/throttler (needs a GraphQL adapter and fails when Redis is down, this
 * degrades) or nginx (per IP only, cannot use x-api-key).
 */
@Injectable()
export class ClientThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ClientThrottleGuard.name);

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = GqlExecutionContext.create(context).getContext<{ req: RequestLike }>();
    const id = clientId(req);
    const { count, ttlSeconds } = await this.redis.incrWithTtl(
      `throttle:${id}`,
      this.config.clientRateWindowSeconds,
    );
    if (count > this.config.clientRateLimit) {
      // Log only the first refusal of a window, not every blocked request.
      if (count === this.config.clientRateLimit + 1) {
        this.logger.warn(
          `Client ${id} is over the limit (${this.config.clientRateLimit} requests per ${this.config.clientRateWindowSeconds} s); refusing for ${ttlSeconds} s`,
        );
      }
      throw new ClientRateLimitedError(ttlSeconds);
    }
    return true;
  }
}
