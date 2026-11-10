import { LocationNotFoundError, InvalidInputError } from '../../src/common/errors';
import { LocationsService } from '../../src/locations/locations.service';
import { createTestContext, TestContext } from '../support/test-module';

describe('LocationsService (real Postgres and Redis)', () => {
  let ctx: TestContext;
  let locations: LocationsService;

  beforeAll(async () => {
    ctx = await createTestContext({ maxStoredLocations: 3 });
    locations = ctx.module.get(LocationsService);
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  const count = (): Promise<number> => ctx.prisma.location.count();

  describe('resolving a name', () => {
    it('geocodes a new city once and stores it', async () => {
      const location = await locations.resolve('Innsbruck');
      expect(location).toMatchObject({
        name: 'Innsbruck',
        countryCode: 'AT',
        timezone: 'Europe/Vienna',
        externalId: 2775220,
        marineAvailable: null,
      });
      expect(ctx.fake.calls.geocode).toBe(1);
      expect(await count()).toBe(1);
    });

    it('does not geocode again for a name it has seen', async () => {
      const first = await locations.resolve('Innsbruck');
      const second = await locations.resolve('Innsbruck');
      expect(second.id).toBe(first.id);
      expect(ctx.fake.calls.geocode).toBe(1);
      expect(await ctx.prisma.locationAlias.count()).toBe(1);
    });

    it('treats case and extra spaces as the same name', async () => {
      const first = await locations.resolve('Innsbruck');
      const second = await locations.resolve('  INNSBRUCK ');
      expect(second.id).toBe(first.id);
      expect(ctx.fake.calls.geocode).toBe(1);
    });

    it('stores alternate spellings as aliases of one place', async () => {
      const munich = await locations.resolve('Munich');
      const munchen = await locations.resolve('Munchen');
      expect(munchen.id).toBe(munich.id);
      expect(ctx.fake.calls.geocode).toBe(2);
      expect(await count()).toBe(1);
      expect(await ctx.prisma.locationAlias.count()).toBe(2);
    });

    it('uses the best match for an ambiguous name and a country code to pick another', async () => {
      const france = await locations.resolve('Paris');
      const texas = await locations.resolve('Paris', 'us');
      expect(france.countryCode).toBe('FR');
      expect(texas).toMatchObject({ countryCode: 'US', region: 'Texas' });
      expect(texas.id).not.toBe(france.id);
      expect(await count()).toBe(2);
    });

    it('prefers a settlement over other geocoder features', async () => {
      const zermatt = await locations.resolve('Zermatt');
      expect(zermatt.name).toBe('Zermatt');
    });

    it('rejects an unknown city without storing anything', async () => {
      await expect(locations.resolve('Atlantis')).rejects.toBeInstanceOf(LocationNotFoundError);
      expect(await count()).toBe(0);
      expect(await ctx.prisma.locationAlias.count()).toBe(0);
    });

    it('rejects input that is too short before calling the geocoder', async () => {
      await expect(locations.resolve('P')).rejects.toBeInstanceOf(InvalidInputError);
      expect(ctx.fake.calls.geocode).toBe(0);
    });
  });

  describe('searching', () => {
    it('lists candidates without storing them', async () => {
      const candidates = await locations.search('Paris');
      expect(candidates.length).toBeGreaterThanOrEqual(3);
      expect(candidates[0].countryCode).toBe('FR');
      expect(await count()).toBe(0);
    });

    it('can be narrowed by country', async () => {
      const candidates = await locations.search('Paris', 'US');
      expect(candidates.every((c) => c.countryCode === 'US')).toBe(true);
    });
  });

  describe('unique keys', () => {
    it('keeps exactly one row when many requests resolve the same new city at once', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => locations.resolve('Biarritz')),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(await count()).toBe(1);
      expect(await ctx.prisma.locationAlias.count()).toBe(1);
    });

    it('is enforced by the database itself, not only by the code', async () => {
      const location = await locations.resolve('Innsbruck');
      await expect(
        ctx.prisma.location.create({
          data: {
            externalId: location.externalId,
            name: 'Duplicate',
            latitude: 0,
            longitude: 0,
            timezone: 'UTC',
            lastRequestedAt: new Date(),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        ctx.prisma.locationAlias.create({
          data: { query: 'innsbruck|', locationId: location.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('keeping the number of stored locations bounded', () => {
    const resolveTown = async (n: number) => {
      const location = await locations.resolve(`town${n}`);
      ctx.clock.advanceSeconds(60);
      return location;
    };

    it('removes the least recently requested location, with its data, beyond the cap', async () => {
      const first = await resolveTown(1);
      await ctx.prisma.dailyWeather.create({ data: { locationId: first.id, date: '2026-11-10' } });
      await ctx.prisma.fetchState.create({
        data: { locationId: first.id, fetchedAt: new Date(), expiresAt: new Date() },
      });
      await resolveTown(2);
      await resolveTown(3);
      expect(await count()).toBe(3);

      await resolveTown(4);

      expect(await count()).toBe(3);
      const remaining = (await ctx.prisma.location.findMany()).map((l) => l.name).sort();
      expect(remaining).toEqual(['Town2', 'Town3', 'Town4']);
      expect(await ctx.prisma.dailyWeather.count({ where: { locationId: first.id } })).toBe(0);
      expect(await ctx.prisma.fetchState.count({ where: { locationId: first.id } })).toBe(0);
      expect(await ctx.prisma.locationAlias.count({ where: { locationId: first.id } })).toBe(0);
    });

    it('treats a city that was asked for again as recently used', async () => {
      await resolveTown(1);
      await resolveTown(2);
      await resolveTown(3);
      ctx.clock.advanceHours(2);
      await locations.resolve('town1'); // refreshes its lastRequestedAt
      ctx.clock.advanceSeconds(60);

      await resolveTown(4);

      const remaining = (await ctx.prisma.location.findMany()).map((l) => l.name).sort();
      expect(remaining).toEqual(['Town1', 'Town3', 'Town4']);
    });

    it('re-resolves an evicted city as a new one', async () => {
      await resolveTown(1);
      await resolveTown(2);
      await resolveTown(3);
      await resolveTown(4);
      ctx.fake.calls.geocode = 0;
      const again = await locations.resolve('town1');
      expect(again.name).toBe('Town1');
      expect(ctx.fake.calls.geocode).toBe(1);
    });

    it('does not write on every read: lastRequestedAt moves at most once an hour', async () => {
      const first = await locations.resolve('town1');
      ctx.clock.advanceSeconds(30 * 60);
      await locations.resolve('town1');
      const afterHalfHour = await ctx.prisma.location.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(afterHalfHour.lastRequestedAt.getTime()).toBe(first.lastRequestedAt.getTime());

      ctx.clock.advanceSeconds(31 * 60);
      await locations.resolve('town1');
      const afterAnHour = await ctx.prisma.location.findUniqueOrThrow({ where: { id: first.id } });
      expect(afterAnHour.lastRequestedAt.getTime()).toBeGreaterThan(
        first.lastRequestedAt.getTime(),
      );
    });
  });
});
