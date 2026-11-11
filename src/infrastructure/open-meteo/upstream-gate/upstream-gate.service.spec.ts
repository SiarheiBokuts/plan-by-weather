import { testConfig } from '../../../../test/support/builders';
import { FakeClock } from '../../../../test/support/fake-clock';
import { OpenMeteoRateLimitedError } from '../../../common/errors';
import { RedisService } from '../../redis/redis.service';
import { retryAfterSeconds, UpstreamGate } from './upstream-gate.service';

const headers = (values: Record<string, string>) => ({
  get: (name: string): string | null => values[name.toLowerCase()] ?? null,
});

describe('retryAfterSeconds', () => {
  const now = new Date('2026-11-10T10:00:00Z');

  it('reads Retry-After in seconds', () => {
    expect(retryAfterSeconds(headers({ 'retry-after': '120' }), now)).toBe(120);
  });

  it('reads Retry-After as an HTTP date', () => {
    expect(
      retryAfterSeconds(headers({ 'retry-after': 'Tue, 10 Nov 2026 10:05:00 GMT' }), now),
    ).toBe(300);
  });

  it('ignores a Retry-After date in the past and tries the next header', () => {
    expect(
      retryAfterSeconds(headers({ 'retry-after': 'Tue, 10 Nov 2026 09:00:00 GMT' }), now),
    ).toBeNull();
  });

  it('ignores garbage in Retry-After', () => {
    expect(retryAfterSeconds(headers({ 'retry-after': 'soon' }), now)).toBeNull();
  });

  it('falls back to X-RateLimit-Reset (epoch seconds)', () => {
    const reset = String(now.getTime() / 1000 + 90);
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset': reset }), now)).toBe(90);
  });

  it('ignores a reset time that has already passed', () => {
    const reset = String(now.getTime() / 1000 - 5);
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset': reset }), now)).toBeNull();
  });

  it('returns null when no usable header is present', () => {
    expect(retryAfterSeconds(headers({}), now)).toBeNull();
  });
});

describe('UpstreamGate', () => {
  let clock: FakeClock;
  let gate: UpstreamGate;

  beforeEach(() => {
    clock = new FakeClock();
    gate = new UpstreamGate(
      new RedisService(clock),
      clock,
      testConfig({ upstreamPauseMinutes: 15 }),
    );
  });

  it('is open until a pause is recorded', async () => {
    await expect(gate.assertOpen()).resolves.toBeUndefined();
    expect(await gate.remainingSeconds()).toBeNull();
  });

  it('pauses for the time the upstream asked for', async () => {
    expect(await gate.pause(120)).toBe(120);
    expect(await gate.remainingSeconds()).toBe(120);
    await expect(gate.assertOpen()).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
  });

  it('pauses for the configured default when the upstream gave no time', async () => {
    expect(await gate.pause(null)).toBe(900);
    expect(await gate.pause(0)).toBe(900);
  });

  it('tells how long is left as time passes', async () => {
    await gate.pause(100);
    clock.advanceSeconds(40);
    expect(await gate.remainingSeconds()).toBe(60);
    await expect(gate.assertOpen()).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('opens again when the pause is over', async () => {
    await gate.pause(100);
    clock.advanceSeconds(101);
    expect(await gate.remainingSeconds()).toBeNull();
    await expect(gate.assertOpen()).resolves.toBeUndefined();
  });

  it('never pauses for longer than a day', async () => {
    expect(await gate.pause(10 * 24 * 3600)).toBe(24 * 3600);
  });
});
