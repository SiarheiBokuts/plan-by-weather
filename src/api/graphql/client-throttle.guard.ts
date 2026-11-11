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
 * How it works, step by step (Nest runs `canActivate` before every resolver method):
 *   1. Find the client: the `x-api-key` header, else the IP address (hashed, see clientId).
 *   2. Ask Redis to count this request for that client (`incrWithTtl`): it returns the number of
 *      requests so far in the current window (60 s by default) and how many seconds are left.
 *   3. If the number is within CLIENT_RATE_LIMIT (60), let the request through.
 *   4. If it is above, throw an error that says when to try again; the resolver is not called.
 * There is no "reset" code: when the window ends Redis deletes the counter, and the next request
 * starts a new one at 1. Example with a limit of 60: requests 1..60 pass, request 61 is refused
 * with "try again in N seconds", and after N seconds the client starts again from 1.
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
    // Step 2: count this request. `count` = how many so far in this window, `ttlSeconds` = time left in it.
    const { count, ttlSeconds } = await this.redis.incrWithTtl(
      `throttle:${id}`,
      this.config.clientRateWindowSeconds,
    );
    // Steps 3 and 4: over the limit means refuse, otherwise let it through.
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
