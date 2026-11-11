import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../common/clock';
import { OpenMeteoRateLimitedError } from '../../../common/errors';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { RedisService } from '../../redis/redis.service';

const BLOCKED_UNTIL_KEY = 'upstream:blocked_until';
const MAX_PAUSE_SECONDS = 24 * 60 * 60;

/**
 * Reads how long Open-Meteo wants us to wait: `Retry-After` (seconds or HTTP date), else the
 * `X-RateLimit-Reset` epoch seconds. Returns null when neither is usable.
 */
export function retryAfterSeconds(
  headers: { get(name: string): string | null },
  now: Date,
): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.ceil(asSeconds);
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      const seconds = Math.ceil((asDate - now.getTime()) / 1000);
      if (seconds > 0) return seconds;
    }
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const seconds = Math.ceil(reset - now.getTime() / 1000);
    if (seconds > 0) return seconds;
  }
  return null;
}

/**
 * Remembers, in one shared key, until when Open-Meteo must not be called. Set after it answers
 * "429 too many requests"; every instance honours it, so no request is wasted while paused.
 * No circuit-breaker library: we only need "do not call until time T", which Open-Meteo tells us.
 */
@Injectable()
export class UpstreamGate {
  private readonly logger = new Logger(UpstreamGate.name);

  constructor(
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws OpenMeteoRateLimitedError (without any network call) while paused. */
  async assertOpen(): Promise<void> {
    const remaining = await this.remainingSeconds();
    if (remaining !== null) {
      this.logger.warn(`Open-Meteo calls are paused for another ${remaining} s; not calling it`);
      throw new OpenMeteoRateLimitedError(remaining);
    }
  }

  /** Seconds until calls may resume, or null when not paused. */
  async remainingSeconds(): Promise<number | null> {
    const raw = await this.redis.get(BLOCKED_UNTIL_KEY);
    if (raw === null) return null;
    const seconds = Math.ceil((Number(raw) - this.clock.now().getTime()) / 1000);
    return seconds > 0 ? seconds : null;
  }

  /** Pauses calls for the time the upstream asked for, or the configured default. */
  async pause(requestedSeconds: number | null): Promise<number> {
    const base =
      requestedSeconds !== null && requestedSeconds > 0
        ? requestedSeconds
        : this.config.upstreamPauseMinutes * 60;
    const seconds = Math.min(Math.ceil(base), MAX_PAUSE_SECONDS);
    const until = this.clock.now().getTime() + seconds * 1000;
    await this.redis.setWithTtl(BLOCKED_UNTIL_KEY, String(until), seconds);
    return seconds;
  }
}
