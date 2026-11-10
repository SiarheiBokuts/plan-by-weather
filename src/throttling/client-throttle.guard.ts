import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { createHash } from 'crypto';
import { ClientRateLimitedError } from '../common/errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RedisService } from '../redis/redis.service';

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
 */
@Injectable()
export class ClientThrottleGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = GqlExecutionContext.create(context).getContext<{ req: RequestLike }>();
    const { count, ttlSeconds } = await this.redis.incrWithTtl(
      `throttle:${clientId(req)}`,
      this.config.clientRateWindowSeconds,
    );
    if (count > this.config.clientRateLimit) throw new ClientRateLimitedError(ttlSeconds);
    return true;
  }
}
