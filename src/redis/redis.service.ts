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
import { Clock } from '../common/clock';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

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

  async onModuleInit(): Promise<void> {
    await this.waitUntilReady(3000);
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  /** Waits briefly for the first connection so the first requests do not use the fallback. */
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

  /** Increments a counter; the first increment starts its expiry window. */
  async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const ttl = this.requireTtl(ttlSeconds);
    return this.run(
      async (c) => {
        const results = await c.multi().incr(key).expire(key, ttl, 'NX').ttl(key).exec();
        if (!results) throw new Error('Redis transaction aborted');
        const [incrErr, count] = results[0];
        const [ttlErr, remaining] = results[2];
        if (incrErr || ttlErr) throw incrErr ?? ttlErr;
        return { count: Number(count), ttlSeconds: Math.max(Number(remaining), 1) };
      },
      () => this.memoryIncr(key, ttl),
    );
  }

  /** Tries to take a lock; returns a token to release it, or null if someone else holds it. */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    return this.run(
      async (c) => ((await c.set(key, token, 'PX', ttlMs, 'NX')) === 'OK' ? token : null),
      () => (this.memoryGet(key) === null ? this.memorySetReturn(key, token, ttlMs) : null),
    );
  }

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

  private requireTtl(ttlSeconds: number): number {
    const ttl = Math.ceil(ttlSeconds);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new Error('Redis keys must be written with a positive TTL');
    }
    return ttl;
  }

  private async run<T>(op: (client: Redis) => Promise<T>, fallback: () => T): Promise<T> {
    if (!this.client) return fallback();
    try {
      return await op(this.client);
    } catch (error) {
      this.warn(error);
      return fallback();
    }
  }

  private warn(error: unknown): void {
    const now = this.clock.now().getTime();
    if (now - this.lastWarningAt < 60_000) return;
    this.lastWarningAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis unavailable, using in-memory fallback: ${message}`);
  }

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
