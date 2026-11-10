import { testConfig } from '../../test/support/builders';
import { FakeClock } from '../../test/support/fake-clock';
import { createFakeOpenMeteo, FakeOpenMeteo } from '../../test/support/fake-open-meteo';
import { OpenMeteoRateLimitedError, OpenMeteoUnavailableError } from '../common/errors';
import { RedisService } from '../redis/redis.service';
import { FetchFn, OpenMeteoClient } from './open-meteo.client';
import { UpstreamGate } from './upstream-gate.service';

function setup(fetchFn?: FetchFn) {
  const clock = new FakeClock();
  const config = testConfig({ upstreamPauseMinutes: 15 });
  const gate = new UpstreamGate(new RedisService(clock), clock, config);
  const fake: FakeOpenMeteo = createFakeOpenMeteo();
  const client = new OpenMeteoClient(config, fetchFn ?? fake.fetch, gate, clock);
  return { client, fake, gate, clock };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe('OpenMeteoClient', () => {
  describe('requests', () => {
    it('geocodes a name, asking for a limited number of matches in English', async () => {
      const { client, fake } = setup();
      const results = await client.geocode('Paris');
      expect(results[0].name).toBe('Paris');
      const url = new URL(fake.urls[0]);
      expect(url.searchParams.get('name')).toBe('Paris');
      expect(url.searchParams.get('count')).toBe('5');
      expect(url.searchParams.get('language')).toBe('en');
      expect(url.searchParams.has('countryCode')).toBe(false);
    });

    it('passes a country code and a custom match count through', async () => {
      const { client, fake } = setup();
      const results = await client.geocode('Paris', 'US', 10);
      expect(results.every((r) => r.countryCode === 'US')).toBe(true);
      const url = new URL(fake.urls[0]);
      expect(url.searchParams.get('countryCode')).toBe('US');
      expect(url.searchParams.get('count')).toBe('10');
    });

    it('asks only for the daily fields the scorers use, plus hourly snow depth', async () => {
      const { client, fake } = setup();
      const forecast = await client.forecast(47.26, 11.39);
      expect(forecast.days).toHaveLength(7);
      const url = new URL(fake.urls[0]);
      expect(url.searchParams.get('latitude')).toBe('47.26');
      expect(url.searchParams.get('hourly')).toBe('snow_depth');
      expect(url.searchParams.get('timezone')).toBe('auto');
      expect(url.searchParams.get('forecast_days')).toBe('7');
      expect(url.searchParams.get('daily')?.split(',')).toEqual(
        expect.arrayContaining(['precipitation_sum', 'snowfall_sum', 'wind_speed_10m_max']),
      );
    });

    it('returns wave data for a coastal point and null for an inland one', async () => {
      const { client } = setup();
      expect(await client.marine(43.48, -1.56)).toHaveLength(7);
      expect(await client.marine(48.14, 11.58)).toBeNull();
    });

    it('sends a timeout signal with every request', async () => {
      const fetchFn = jest
        .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
        .mockResolvedValue(jsonResponse({}));
      const { client } = setup(fetchFn);
      await client.geocode('Paris');
      expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('when Open-Meteo says "too many requests"', () => {
    it('pauses for the time it asked for and tells the caller', async () => {
      const { client, fake, gate } = setup();
      fake.mode = 'rate-limited';
      fake.retryAfter = '600';
      await expect(client.forecast(1, 1)).rejects.toMatchObject({
        retryAfterSeconds: 600,
        extensions: { code: 'OPEN_METEO_RATE_LIMITED' },
      });
      expect(await gate.remainingSeconds()).toBe(600);
    });

    it('uses the configured default pause when no time is given', async () => {
      const { client, fake } = setup();
      fake.mode = 'rate-limited';
      await expect(client.forecast(1, 1)).rejects.toMatchObject({ retryAfterSeconds: 900 });
    });

    it('makes no further calls while paused, for any endpoint', async () => {
      const { client, fake } = setup();
      fake.mode = 'rate-limited';
      await expect(client.forecast(1, 1)).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
      expect(fake.calls.forecast).toBe(1);

      fake.mode = 'ok';
      await expect(client.forecast(1, 1)).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
      await expect(client.geocode('Paris')).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
      await expect(client.marine(1, 1)).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
      expect(fake.calls).toEqual({ geocode: 0, forecast: 1, marine: 0 });
    });

    it('calls again once the pause is over', async () => {
      const { client, fake, clock } = setup();
      fake.mode = 'rate-limited';
      fake.retryAfter = '60';
      await expect(client.forecast(1, 1)).rejects.toBeInstanceOf(OpenMeteoRateLimitedError);
      fake.mode = 'ok';
      clock.advanceSeconds(61);
      await expect(client.forecast(1, 1)).resolves.toBeDefined();
    });
  });

  describe('failures', () => {
    it('retries once after a server error and succeeds', async () => {
      const fetchFn = jest
        .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
        .mockResolvedValueOnce(new Response('oops', { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));
      const { client } = setup(fetchFn);
      await expect(client.geocode('Paris')).resolves.toEqual([]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('gives up after two server errors', async () => {
      const { client, fake } = setup();
      fake.mode = 'down';
      await expect(client.forecast(1, 1)).rejects.toMatchObject({
        extensions: { code: 'OPEN_METEO_UNAVAILABLE', detail: 'HTTP 503' },
      });
      expect(fake.calls.forecast).toBe(2);
    });

    it('retries once after a network error', async () => {
      const fetchFn = jest
        .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));
      const { client } = setup(fetchFn);
      await expect(client.geocode('Paris')).resolves.toEqual([]);
    });

    it('reports the last network error after two failures', async () => {
      const { client, fake } = setup();
      fake.mode = 'network-error';
      const error = await client.forecast(1, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenMeteoUnavailableError);
      expect((error as OpenMeteoUnavailableError).extensions.detail).toContain('ECONNREFUSED');
      expect(fake.calls.forecast).toBe(2);
    });

    it('describes a thrown non-Error value', async () => {
      const fetchFn = jest.fn().mockRejectedValue('weird');
      const { client } = setup(fetchFn as unknown as FetchFn);
      await expect(client.geocode('x')).rejects.toMatchObject({
        extensions: { detail: 'weird' },
      });
    });

    it('does not retry a client error such as 404', async () => {
      const fetchFn = jest
        .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
        .mockResolvedValue(new Response('nope', { status: 404 }));
      const { client } = setup(fetchFn);
      await expect(client.geocode('x')).rejects.toMatchObject({
        extensions: { detail: 'HTTP 404' },
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('treats a body that is not JSON as the service being unavailable', async () => {
      const fetchFn = jest
        .fn<ReturnType<FetchFn>, Parameters<FetchFn>>()
        .mockResolvedValue(new Response('<html>', { status: 200 }));
      const { client } = setup(fetchFn);
      await expect(client.geocode('x')).rejects.toMatchObject({
        extensions: { detail: 'Response was not valid JSON' },
      });
    });
  });
});
