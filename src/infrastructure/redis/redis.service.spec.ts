import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';
import { FakeClock } from '../../../test/support/fake-clock';
import { RedisService } from './redis.service';

describe('RedisService without a Redis connection (in-memory mode)', () => {
  let clock: FakeClock;
  let redis: RedisService;

  beforeEach(() => {
    clock = new FakeClock();
    redis = new RedisService(clock);
  });

  describe('keys with a TTL', () => {
    it('returns null for a missing key', async () => {
      expect(await redis.get('nope')).toBeNull();
    });

    it('stores a value until its TTL passes', async () => {
      await redis.setWithTtl('k', 'v', 10);
      expect(await redis.get('k')).toBe('v');
      clock.advanceSeconds(9);
      expect(await redis.get('k')).toBe('v');
      clock.advanceSeconds(1);
      expect(await redis.get('k')).toBeNull();
    });

    it('rounds a fractional TTL up', async () => {
      await redis.setWithTtl('k', 'v', 0.2);
      expect(await redis.get('k')).toBe('v');
      clock.advanceSeconds(1);
      expect(await redis.get('k')).toBeNull();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'refuses to write a key without a usable TTL (%s)',
      async (ttl) => {
        await expect(redis.setWithTtl('k', 'v', ttl)).rejects.toThrow(/positive TTL/);
        await expect(redis.incrWithTtl('k', ttl)).rejects.toThrow(/positive TTL/);
      },
    );
  });

  describe('counters', () => {
    it('counts within a window and reports the time left', async () => {
      expect(await redis.incrWithTtl('c', 60)).toEqual({ count: 1, ttlSeconds: 60 });
      clock.advanceSeconds(20);
      expect(await redis.incrWithTtl('c', 60)).toEqual({ count: 2, ttlSeconds: 40 });
      expect((await redis.incrWithTtl('c', 60)).count).toBe(3);
    });

    it('starts a fresh window after the old one expires', async () => {
      await redis.incrWithTtl('c', 60);
      await redis.incrWithTtl('c', 60);
      clock.advanceSeconds(61);
      expect(await redis.incrWithTtl('c', 60)).toEqual({ count: 1, ttlSeconds: 60 });
    });

    it('keeps separate counters per key', async () => {
      await redis.incrWithTtl('a', 60);
      expect((await redis.incrWithTtl('b', 60)).count).toBe(1);
    });
  });

  describe('locks', () => {
    it('lets only one holder in at a time', async () => {
      const first = await redis.acquireLock('lock', 1000);
      expect(first).toEqual(expect.any(String));
      expect(await redis.acquireLock('lock', 1000)).toBeNull();
    });

    it('can be taken again after a release', async () => {
      const token = (await redis.acquireLock('lock', 1000)) as string;
      await redis.releaseLock('lock', token);
      expect(await redis.acquireLock('lock', 1000)).not.toBeNull();
    });

    it('is not released by someone who does not hold it', async () => {
      await redis.acquireLock('lock', 1000);
      await redis.releaseLock('lock', 'someone-elses-token');
      expect(await redis.acquireLock('lock', 1000)).toBeNull();
    });

    it('expires by itself so a crashed holder cannot block forever', async () => {
      await redis.acquireLock('lock', 1000);
      clock.advanceSeconds(2);
      expect(await redis.acquireLock('lock', 1000)).not.toBeNull();
    });
  });

  it('reports itself as disabled and is ready immediately', async () => {
    expect(await redis.status()).toBe('disabled');
    await expect(redis.waitUntilReady(10)).resolves.toBeUndefined();
    await expect(redis.onModuleInit()).resolves.toBeUndefined();
    expect(() => redis.onModuleDestroy()).not.toThrow();
  });
});

describe('RedisService with a client', () => {
  type Stub = Record<string, jest.Mock>;
  const asClient = (stub: unknown): Redis => stub as Redis;

  function chain(execResult: unknown): Record<string, jest.Mock> {
    const multi: Record<string, jest.Mock> = {};
    multi.incr = jest.fn(() => multi);
    multi.expire = jest.fn(() => multi);
    multi.ttl = jest.fn(() => multi);
    multi.exec = jest.fn().mockResolvedValue(execResult);
    return multi;
  }

  it('passes reads and writes to Redis, always with an expiry', async () => {
    const stub: Stub = {
      get: jest.fn().mockResolvedValue('stored'),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const redis = new RedisService(new FakeClock(), asClient(stub));
    expect(await redis.get('k')).toBe('stored');
    await redis.setWithTtl('k', 'v', 30);
    expect(stub.set).toHaveBeenCalledWith('k', 'v', 'EX', 30);
  });

  it('counts and starts the expiry together, in one step', async () => {
    const multi = chain([
      [null, 3],
      [null, 1],
      [null, 42],
    ]);
    const redis = new RedisService(new FakeClock(), asClient({ multi: () => multi }));
    expect(await redis.incrWithTtl('c', 60)).toEqual({ count: 3, ttlSeconds: 42 });
    expect(multi.expire).toHaveBeenCalledWith('c', 60, 'NX');
  });

  it('never reports less than one second left', async () => {
    const multi = chain([
      [null, 1],
      [null, 0],
      [null, -1],
    ]);
    const redis = new RedisService(new FakeClock(), asClient({ multi: () => multi }));
    expect((await redis.incrWithTtl('c', 60)).ttlSeconds).toBe(1);
  });

  it('takes and releases a lock with a token check', async () => {
    const stub: Stub = {
      set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      eval: jest.fn().mockResolvedValue(1),
    };
    const redis = new RedisService(new FakeClock(), asClient(stub));
    const token = await redis.acquireLock('lock', 5000);
    expect(token).toEqual(expect.any(String));
    expect(stub.set).toHaveBeenCalledWith('lock', token, 'PX', 5000, 'NX');
    expect(await redis.acquireLock('lock', 5000)).toBeNull();
    await redis.releaseLock('lock', token as string);
    expect(stub.eval).toHaveBeenCalledWith(expect.stringContaining('del'), 1, 'lock', token);
  });

  describe('when Redis fails', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    const failing = (): Stub => {
      const error = new Error("Stream isn't writeable");
      return {
        get: jest.fn().mockRejectedValue(error),
        set: jest.fn().mockRejectedValue(error),
        multi: jest.fn(() => chain(null)),
        eval: jest.fn().mockRejectedValue(error),
      };
    };

    it('falls back to memory instead of failing the request', async () => {
      const redis = new RedisService(new FakeClock(), asClient(failing()));
      await redis.setWithTtl('k', 'v', 30);
      // the write landed in the in-memory fallback, and so does the read
      expect(await redis.get('k')).toBe('v');
      const token = await redis.acquireLock('lock', 1000);
      expect(token).not.toBeNull();
      expect(await redis.acquireLock('lock', 1000)).toBeNull();
      await expect(redis.releaseLock('lock', token as string)).resolves.toBeUndefined();
      expect((await redis.incrWithTtl('c', 60)).count).toBe(1);
      expect((await redis.incrWithTtl('c', 60)).count).toBe(2);
    });

    it('falls back when a counter transaction is aborted or reports an error', async () => {
      const aborted = new RedisService(new FakeClock(), asClient({ multi: () => chain(null) }));
      expect((await aborted.incrWithTtl('c', 60)).count).toBe(1);

      const errored = new RedisService(
        new FakeClock(),
        asClient({
          multi: () =>
            chain([
              [new Error('boom'), null],
              [null, 1],
              [null, 1],
            ]),
        }),
      );
      expect((await errored.incrWithTtl('c', 60)).count).toBe(1);

      const ttlErrored = new RedisService(
        new FakeClock(),
        asClient({
          multi: () =>
            chain([
              [null, 1],
              [null, 1],
              [new Error('ttl'), null],
            ]),
        }),
      );
      expect((await ttlErrored.incrWithTtl('c', 60)).count).toBe(1);
    });

    it('warns once a minute, not on every failed call', async () => {
      const clock = new FakeClock();
      const redis = new RedisService(clock, asClient(failing()));
      await redis.get('a');
      await redis.get('b');
      await redis.get('c');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('in-memory fallback');
      clock.advanceSeconds(61);
      await redis.get('d');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('also logs failures that are not Error objects', async () => {
      const stub = { get: jest.fn().mockRejectedValue('plain string failure') };
      const redis = new RedisService(new FakeClock(), asClient(stub));
      await redis.get('k');
      expect(warn.mock.calls[0][0]).toContain('plain string failure');
    });
  });

  describe('status and readiness', () => {
    it('reports up when PING works and down when it does not', async () => {
      const up = new RedisService(
        new FakeClock(),
        asClient({ ping: jest.fn().mockResolvedValue('PONG') }),
      );
      expect(await up.status()).toBe('up');
      const down = new RedisService(
        new FakeClock(),
        asClient({ ping: jest.fn().mockRejectedValue(new Error('down')) }),
      );
      expect(await down.status()).toBe('down');
    });

    it('does not wait when the client is already ready', async () => {
      const redis = new RedisService(new FakeClock(), asClient({ status: 'ready' }));
      await expect(redis.waitUntilReady(10_000)).resolves.toBeUndefined();
    });

    it('waits for the ready event', async () => {
      const client = Object.assign(new EventEmitter(), { status: 'connecting' });
      const redis = new RedisService(new FakeClock(), asClient(client));
      const waiting = redis.waitUntilReady(10_000);
      client.emit('ready');
      await expect(waiting).resolves.toBeUndefined();
      expect(client.listenerCount('ready')).toBe(0);
    });

    it('gives up waiting after the timeout so startup is not blocked', async () => {
      const client = Object.assign(new EventEmitter(), { status: 'connecting' });
      const redis = new RedisService(new FakeClock(), asClient(client));
      await expect(redis.waitUntilReady(20)).resolves.toBeUndefined();
      expect(client.listenerCount('ready')).toBe(0);
    });

    it('disconnects on shutdown', () => {
      const disconnect = jest.fn();
      const redis = new RedisService(new FakeClock(), asClient({ disconnect }));
      redis.onModuleDestroy();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
