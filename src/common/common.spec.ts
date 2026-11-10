import { localDate, SystemClock } from './clock';
import {
  ClientRateLimitedError,
  ErrorCode,
  humanWait,
  InvalidInputError,
  LocationNotFoundError,
  OpenMeteoRateLimitedError,
  OpenMeteoUnavailableError,
} from './errors';

describe('humanWait', () => {
  it.each([
    [10, 'less than a minute'],
    [59, 'less than a minute'],
    [60, 'about 1 minute'],
    [61, 'about 2 minutes'],
    [900, 'about 15 minutes'],
    [3600, 'about 1 hour'],
    [3601, 'about 2 hours'],
    [86400, 'about 24 hours'],
  ])('%s seconds is "%s"', (seconds, text) => {
    expect(humanWait(seconds)).toBe(text);
  });
});

describe('errors', () => {
  it('carries a stable code and a user-friendly message', () => {
    expect(new LocationNotFoundError('Atlantis').extensions.code).toBe(ErrorCode.LocationNotFound);
    expect(new LocationNotFoundError('Atlantis').message).toContain('"Atlantis"');
    expect(new InvalidInputError('too short').extensions.code).toBe('BAD_USER_INPUT');
  });

  it('tells the user when a client may try again', () => {
    const error = new ClientRateLimitedError(30);
    expect(error.extensions).toMatchObject({ code: 'CLIENT_RATE_LIMITED', retryAfterSeconds: 30 });
    expect(error.message).toBe('Too many requests. Please try again in less than a minute.');
  });

  it('explains an Open-Meteo pause with an approximate wait', () => {
    const error = new OpenMeteoRateLimitedError(900);
    expect(error.extensions).toMatchObject({
      code: 'OPEN_METEO_RATE_LIMITED',
      retryAfterSeconds: 900,
    });
    expect(error.message).toBe(
      "We can't load weather for this city right now. Please try again in about 15 minutes.",
    );
    expect(error.retryAfterSeconds).toBe(900);
  });

  it('hides technical detail from the message but keeps it in extensions', () => {
    const error = new OpenMeteoUnavailableError('HTTP 503');
    expect(error.message).not.toContain('503');
    expect(error.extensions).toMatchObject({
      code: 'OPEN_METEO_UNAVAILABLE',
      detail: 'HTTP 503',
      retryAfterSeconds: 60,
    });
  });
});

describe('clock', () => {
  it('SystemClock returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('localDate gives the calendar date in the given time zone', () => {
    const instant = new Date('2026-11-10T23:30:00Z');
    expect(localDate(instant, 'UTC')).toBe('2026-11-10');
    expect(localDate(instant, 'Europe/Vienna')).toBe('2026-11-11');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-11-10');
  });
});
