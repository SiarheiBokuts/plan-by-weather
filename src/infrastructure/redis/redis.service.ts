import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { Clock } from '../../common/clock';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

// Runs inside Redis as one step: delete the lock only if it still holds OUR token. A separate
// get-then-del could delete a lock that expired and was taken by someone else in between.
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

/**
 * Thin wrapper over Redis for disposable data only (rate-limit counters, locks, the Open-Meteo
 * pause). Design rules:
 *  - every key is written WITH a TTL; there is deliberately no way to set a key without one;
 *  - if Redis is unreachable, operations degrade to a per-process in-memory store and log a
 *    warning instead of failing the request.
 * Simpler alternative: drop the in-memory fallback and carry on without limits or locks while Redis is
 * down. Kept because the service then stays protected during an outage.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private lastWarningAt = 0;

  constructor(
    private readonly clock: Clock,
    @Optional() @Inject(REDIS_CLIENT) private readonly client: Redis | null = null,
  ) {}

  // On start, wait up to 3 s for Redis so the very first requests do not use the in-memory fallback.
  async onModuleInit(): Promise<void> {
    await this.waitUntilReady(3000);
  }

  // On shutdown, close the connection (called by Nest because main.ts enables shutdown hooks).
  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  /** Resolves when Redis is connected, or after `timeoutMs`, whichever comes first (never throws). */
  async waitUntilReady(timeoutMs: number): Promise<void> {
    const client = this.client;
    if (!client || client.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function done(): void {
        clearTimeout(timer);
        client?.off('ready', done);
        resolve();
      }
      client.once('ready', done);
    });
  }

  /** Reads a key (null when missing or expired). */
  async get(key: string): Promise<string | null> {
    return this.run(
      (c) => c.get(key),
      () => this.memoryGet(key),
    );
  }

  /** Writes a key that expires after `ttlSeconds` (must be positive). */
  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    const ttl = this.requireTtl(ttlSeconds);
    await this.run(
      async (c) => {
        await c.set(key, value, 'EX', ttl);
      },
      () => this.memorySet(key, value, ttl * 1000),
    );
  }

  /**
   * Counts one more event for `key` inside a time window, and says how many have happened so far.
   * Used for the per-client request limit: the caller compares `count` with its limit.
   *
   * How the window works (a "fixed window", `ttlSeconds` long):
   *   - the first call creates the counter (count = 1) and starts the window;
   *   - every later call in the window adds 1 and returns the seconds left in the window;
   *   - when the window ends Redis deletes the key by itself, so the next call starts a new window.
   */
  async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const ttl = this.requireTtl(ttlSeconds);
    return this.run(
      async (c) => {
        // Three Redis commands sent as ONE transaction (nobody can get in between them):
        //   1. INCR   add 1 to the counter (a missing key starts at 0, so the first call gives 1)
        //   2. EXPIRE set the lifetime of the key, but only if it has none yet (NX): that happens on
        //             the first call and opens the window; later calls do not extend it
        //   3. TTL    seconds the key still has to live = seconds left in the window
        const results = await c.multi().incr(key).expire(key, ttl, 'NX').ttl(key).exec();
        if (!results) throw new Error('Redis transaction aborted');
        // `results` has one [error, value] pair per command, in the order above.
        const [incrError, count] = results[0]; // answer of INCR: how many events so far
        const [ttlError, secondsLeft] = results[2]; // answer of TTL (results[1] is EXPIRE, not needed)
        if (incrError || ttlError) throw incrError ?? ttlError;
        return { count: Number(count), ttlSeconds: Math.max(Number(secondsLeft), 1) };
      },
      () => this.memoryIncr(key, ttl),
    );
  }

  /**
   * Tries to take a lock; returns a token to release it, or null if someone else holds it.
   * `SET key token NX PX ttl`: NX = only if the key does not exist (so only one caller wins),
   * PX = it expires by itself after `ttlMs`, so a crashed holder cannot block the key forever.
   * The random token proves ownership when releasing.
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    return this.run(
      async (c) => ((await c.set(key, token, 'PX', ttlMs, 'NX')) === 'OK' ? token : null),
      () => (this.memoryGet(key) === null ? this.memorySetReturn(key, token, ttlMs) : null),
    );
  }

  /** Releases a lock, but only if `token` is still the holder (see RELEASE_LOCK_SCRIPT). */
  async releaseLock(key: string, token: string): Promise<void> {
    await this.run(
      async (c) => {
        await c.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
      },
      () => {
        if (this.memoryGet(key) === token) this.memory.delete(key);
      },
    );
  }

  /** Health probe that does not use the fallback: reports the real connection state. */
  async status(): Promise<'up' | 'down' | 'disabled'> {
    if (!this.client) return 'disabled';
    try {
      await this.client.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  /** Enforces the rule "no key without an expiry": rejects zero, negative or non-numeric TTLs. */
  private requireTtl(ttlSeconds: number): number {
    const ttl = Math.ceil(ttlSeconds);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new Error('Redis keys must be written with a positive TTL');
    }
    return ttl;
  }

  /** Runs the Redis operation; if Redis is not configured or fails, runs the in-memory `fallback` instead. */
  private async run<T>(op: (client: Redis) => Promise<T>, fallback: () => T): Promise<T> {
    if (!this.client) return fallback();
    try {
      return await op(this.client);
    } catch (error) {
      this.warn(error);
      return fallback();
    }
  }

  /** Logs "Redis unavailable" at most once a minute, so an outage does not flood the logs. */
  private warn(error: unknown): void {
    const now = this.clock.now().getTime();
    if (now - this.lastWarningAt < 60_000) return;
    this.lastWarningAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis unavailable, using in-memory fallback: ${message}`);
  }

  // The four helpers below are the in-memory fallback: a Map with the same expiry rules, per process.
  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySet(key: string, value: string, ttlMs: number): void {
    this.memory.set(key, { value, expiresAt: this.clock.now().getTime() + ttlMs });
  }

  /** `memorySet` that also returns the value (lets the lock fallback be one expression). */
  private memorySetReturn(key: string, value: string, ttlMs: number): string {
    this.memorySet(key, value, ttlMs);
    return value;
  }

  private memoryIncr(key: string, ttlSeconds: number): { count: number; ttlSeconds: number } {
    const now = this.clock.now().getTime();
    const current = this.memoryGet(key);
    if (current === null) {
      this.memorySet(key, '1', ttlSeconds * 1000);
      return { count: 1, ttlSeconds };
    }
    const entry = this.memory.get(key) as MemoryEntry;
    entry.value = String(Number(current) + 1);
    return {
      count: Number(entry.value),
      ttlSeconds: Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1),
    };
  }
}
