import { Location } from '@prisma/client';
import { OpenMeteoRateLimitedError, OpenMeteoUnavailableError } from '../../src/common/errors';
import { ForecastService } from '../../src/modules/forecast/forecast.service';
import { LocationsService } from '../../src/modules/locations/locations.service';
import { OpenMeteoClient } from '../../src/infrastructure/open-meteo/client/open-meteo.client';
import { DataSource } from '../../src/domain/data-source';
import { createTestContext, TestContext } from '../support/test-module';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const SIX_HOURS_MS = 6 * 3_600_000;

describe('ForecastService (real Postgres and Redis, recorded Open-Meteo responses)', () => {
  let ctx: TestContext;
  let locations: LocationsService;
  let forecasts: ForecastService;

  beforeAll(async () => {
    ctx = await createTestContext({ lockWaitMs: 400 });
    locations = ctx.module.get(LocationsService);
    forecasts = ctx.module.get(ForecastService);
  });
  beforeEach(() => ctx.reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => ctx.close());

  const rowCount = (location: Location): Promise<number> =>
    ctx.prisma.dailyWeather.count({ where: { locationId: location.id } });

  describe('the first request for a city', () => {
    it('fetches from Open-Meteo, stores 7 days and says so', async () => {
      const location = await locations.resolve('Innsbruck');
      const result = await forecasts.getForecast(location);

      expect(result.meta).toEqual({
        source: DataSource.OPEN_METEO,
        fetchedAt: ctx.clock.now(),
        nextRefreshAt: new Date(ctx.clock.now().getTime() + SIX_HOURS_MS),
        outdated: false,
      });
      expect(result.days).toHaveLength(7);
      expect(result.days[0]).toMatchObject({ date: '2026-11-11', tempMaxC: 15.1 });
      expect(await rowCount(location)).toBe(7);
      expect(ctx.fake.calls.forecast).toBe(1);
    });

    it('records when the data may be refreshed again', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      const state = await ctx.prisma.fetchState.findUniqueOrThrow({
        where: { locationId: location.id },
      });
      expect(state.expiresAt.getTime() - state.fetchedAt.getTime()).toBe(SIX_HOURS_MS);
      expect(state.lastError).toBeNull();
    });
  });

  describe('the refresh interval', () => {
    it('serves later requests from the database without calling Open-Meteo', async () => {
      const location = await locations.resolve('Innsbruck');
      const first = await forecasts.getForecast(location);
      ctx.clock.advanceHours(5);
      const second = await forecasts.getForecast(location);

      expect(second.meta.source).toBe(DataSource.DATABASE);
      expect(second.meta.fetchedAt).toEqual(first.meta.fetchedAt);
      expect(second.meta.nextRefreshAt).toEqual(first.meta.nextRefreshAt);
      expect(second.days).toEqual(first.days);
      expect(ctx.fake.calls.forecast).toBe(1);
    });

    it('refreshes once the interval has passed and keeps exactly 7 rows', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      await ctx.prisma.dailyWeather.create({
        data: { locationId: location.id, date: new Date('2026-11-01') },
      });
      ctx.clock.advanceHours(6.5);

      const result = await forecasts.getForecast(location);

      expect(result.meta.source).toBe(DataSource.OPEN_METEO);
      expect(ctx.fake.calls.forecast).toBe(2);
      expect(await rowCount(location)).toBe(7);
      const old = await ctx.prisma.dailyWeather.count({
        where: { locationId: location.id, date: new Date('2026-11-01') },
      });
      expect(old).toBe(0);
    });

    it('refreshes when fewer than 7 days remain, even if the interval has not passed', async () => {
      const slow = await createTestContext({ forecastTtlHours: 100 });
      try {
        await slow.reset();
        const location = await slow.module.get(LocationsService).resolve('Innsbruck');
        const service = slow.module.get(ForecastService);
        await service.getForecast(location);
        slow.clock.set('2026-11-12T10:00:00Z'); // two of the stored days are now in the past
        await service.getForecast(location);
        expect(slow.fake.calls.forecast).toBe(2);
      } finally {
        await slow.close();
      }
    });

    it('returns the same days that were stored', async () => {
      const location = await locations.resolve('Innsbruck');
      const fetched = await forecasts.getForecast(location);
      ctx.clock.advanceHours(1);
      const stored = await forecasts.getForecast(location);
      expect(stored.days).toEqual(fetched.days);
    });
  });

  describe('several requests for the same city at once', () => {
    it('make a single Open-Meteo call for ten simultaneous requests', async () => {
      const location = await locations.resolve('Innsbruck');
      const results = await Promise.all(
        Array.from({ length: 10 }, () => forecasts.getForecast(location)),
      );

      expect(ctx.fake.calls.forecast).toBe(1);
      expect(results.every((r) => r.days.length === 7)).toBe(true);
      const sources = results.map((r) => r.meta.source);
      expect(sources.filter((s) => s === DataSource.OPEN_METEO)).toHaveLength(1);
      expect(sources.filter((s) => s === DataSource.DATABASE)).toHaveLength(9);
      expect(await rowCount(location)).toBe(7);
    });

    it('wait for a refresh that is already running and use its result', async () => {
      const location = await locations.resolve('Innsbruck');
      const lockKey = `lock:location:${location.id}`;
      await ctx.redis.set(lockKey, 'another-request', 'PX', 5000);

      const waiting = forecasts.getForecast(location);
      await sleep(150);
      await ctx.redis.del(lockKey);
      const leader = await forecasts.getForecast(location);
      const waited = await waiting;

      expect(leader.meta.source).toBe(DataSource.OPEN_METEO);
      expect(waited.meta.source).toBe(DataSource.DATABASE);
      expect(ctx.fake.calls.forecast).toBe(1);
    });

    it('serve outdated data when a refresh takes too long', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      await ctx.redis.set(`lock:location:${location.id}`, 'stuck', 'PX', 5000);

      const result = await forecasts.getForecast(location);

      expect(result.meta).toMatchObject({ source: DataSource.DATABASE, outdated: true });
      expect(ctx.fake.calls.forecast).toBe(1);
    });

    it('report the service unavailable when there is nothing stored to fall back to', async () => {
      const location = await locations.resolve('Innsbruck');
      await ctx.redis.set(`lock:location:${location.id}`, 'stuck', 'PX', 5000);
      await expect(forecasts.getForecast(location)).rejects.toBeInstanceOf(
        OpenMeteoUnavailableError,
      );
    });

    it('release the lock afterwards so the next refresh can proceed', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      expect(await ctx.redis.exists(`lock:location:${location.id}`)).toBe(0);
    });
  });

  describe('when Open-Meteo says "too many requests"', () => {
    it('serves the stored data as outdated and says when a refresh is possible', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      ctx.fake.mode = 'rate-limited';
      ctx.fake.retryAfter = '600';

      const result = await forecasts.getForecast(location);

      expect(result.days).toHaveLength(7);
      expect(result.meta).toMatchObject({ source: DataSource.DATABASE, outdated: true });
      expect(result.meta.nextRefreshAt).toEqual(new Date(ctx.clock.now().getTime() + 600_000));
    });

    it('makes no more calls while paused', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      ctx.fake.mode = 'rate-limited';
      await forecasts.getForecast(location);
      const callsAfterFirstRejection = ctx.fake.calls.forecast;

      await forecasts.getForecast(location);
      await forecasts.getForecast(location);

      expect(ctx.fake.calls.forecast).toBe(callsAfterFirstRejection);
    });

    it('resumes refreshing when the pause is over', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      ctx.fake.mode = 'rate-limited';
      ctx.fake.retryAfter = '600';
      await forecasts.getForecast(location);

      ctx.fake.mode = 'ok';
      ctx.clock.advanceSeconds(601);
      const result = await forecasts.getForecast(location);

      expect(result.meta).toMatchObject({ source: DataSource.OPEN_METEO, outdated: false });
    });

    it('returns a clear error for a city that has no stored weather yet', async () => {
      const location = await locations.resolve('Innsbruck');
      ctx.fake.mode = 'rate-limited';
      ctx.fake.retryAfter = '900';

      const error = await forecasts.getForecast(location).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OpenMeteoRateLimitedError);
      expect((error as OpenMeteoRateLimitedError).message).toBe(
        "We can't load weather for this city right now. Please try again in about 15 minutes.",
      );
      expect((error as OpenMeteoRateLimitedError).retryAfterSeconds).toBe(900);
      expect(await rowCount(location)).toBe(0);
    });

    it('records the problem on the stored state, and clears it after a success', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      ctx.fake.mode = 'rate-limited';
      await forecasts.getForecast(location);
      const failed = await ctx.prisma.fetchState.findUniqueOrThrow({
        where: { locationId: location.id },
      });
      expect(failed.lastError).toContain('try again');
      expect(failed.lastErrorAt).not.toBeNull();

      ctx.fake.mode = 'ok';
      ctx.clock.advanceHours(1);
      await forecasts.getForecast(location);
      const healthy = await ctx.prisma.fetchState.findUniqueOrThrow({
        where: { locationId: location.id },
      });
      expect(healthy.lastError).toBeNull();
    });
  });

  describe('when Open-Meteo is down', () => {
    it('serves stored data as outdated', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      ctx.clock.advanceHours(7);
      ctx.fake.mode = 'down';

      const result = await forecasts.getForecast(location);

      expect(result.meta.outdated).toBe(true);
      expect(result.meta.fetchedAt.getTime()).toBeLessThan(ctx.clock.now().getTime());
      expect(result.meta.nextRefreshAt.getTime()).toBeGreaterThan(ctx.clock.now().getTime());
    });

    it('reports the service unavailable when nothing is stored', async () => {
      const location = await locations.resolve('Innsbruck');
      ctx.fake.mode = 'down';
      await expect(forecasts.getForecast(location)).rejects.toBeInstanceOf(
        OpenMeteoUnavailableError,
      );
    });
  });

  describe('wave data', () => {
    it('stores wave data for a coastal city', async () => {
      const location = await locations.resolve('Biarritz');
      const result = await forecasts.getForecast(location);

      expect(result.days[0]).toMatchObject({ waveHeightMaxM: 1.04, wavePeriodMaxS: 11.8 });
      const stored = await ctx.prisma.location.findUniqueOrThrow({ where: { id: location.id } });
      expect(stored.marineAvailable).toBe(true);
    });

    it('remembers that an inland city has no waves and stops asking', async () => {
      const location = await locations.resolve('Munich');
      const first = await forecasts.getForecast(location);
      expect(first.days.every((d) => d.waveHeightMaxM === null)).toBe(true);
      expect(ctx.fake.calls.marine).toBe(1);
      const stored = await ctx.prisma.location.findUniqueOrThrow({ where: { id: location.id } });
      expect(stored.marineAvailable).toBe(false);

      ctx.clock.advanceHours(7);
      const reloaded = await ctx.prisma.location.findUniqueOrThrow({ where: { id: location.id } });
      await forecasts.getForecast(reloaded);
      expect(ctx.fake.calls.forecast).toBe(2);
      expect(ctx.fake.calls.marine).toBe(1);
    });

    it('still stores the forecast when only the wave request fails, and asks again later', async () => {
      const location = await locations.resolve('Biarritz');
      ctx.fake.marineMode = 'down';

      const result = await forecasts.getForecast(location);

      expect(result.days).toHaveLength(7);
      expect(result.days.every((d) => d.waveHeightMaxM === null)).toBe(true);
      const stored = await ctx.prisma.location.findUniqueOrThrow({ where: { id: location.id } });
      expect(stored.marineAvailable).toBeNull();
    });
  });

  describe('unexpected errors (a bug must not be hidden as an Open-Meteo problem)', () => {
    it('a bug in the forecast call is reported as it is', async () => {
      const location = await locations.resolve('Innsbruck');
      jest.spyOn(ctx.module.get(OpenMeteoClient), 'forecast').mockRejectedValue(new Error('bug'));
      await expect(forecasts.getForecast(location)).rejects.toThrow('bug');
    });

    it('a bug in the wave call is reported as it is', async () => {
      const location = await locations.resolve('Innsbruck');
      jest.spyOn(ctx.module.get(OpenMeteoClient), 'marine').mockRejectedValue(new Error('bug'));
      await expect(forecasts.getForecast(location)).rejects.toThrow('bug');
    });

    it('a database error reaches the caller instead of being hidden', async () => {
      const location = await locations.resolve('Innsbruck');
      jest.spyOn(ctx.prisma, '$transaction').mockRejectedValueOnce(new Error('db down'));
      await expect(forecasts.getForecast(location)).rejects.toThrow('db down');
    });
  });

  describe('unique keys', () => {
    it('allow one stored day per city and date, enforced by the database', async () => {
      const location = await locations.resolve('Innsbruck');
      await forecasts.getForecast(location);
      await expect(
        ctx.prisma.dailyWeather.create({
          data: { locationId: location.id, date: new Date('2026-11-11') },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        ctx.prisma.fetchState.create({
          data: { locationId: location.id, fetchedAt: new Date(), expiresAt: new Date() },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
