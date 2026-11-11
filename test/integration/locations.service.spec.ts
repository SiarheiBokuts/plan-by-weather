import { LocationNotFoundError, InvalidInputError } from '../../src/common/errors';
import { LocationsService } from '../../src/modules/locations/locations.service';
import { createTestContext, TestContext } from '../support/test-module';

describe('LocationsService (real Postgres and Redis)', () => {
  let ctx: TestContext;
  let locations: LocationsService;

  beforeAll(async () => {
    ctx = await createTestContext();
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

    it('stores what was typed as a name plus a country code, in separate columns', async () => {
      const munich = await locations.resolve('  MUNCHEN ');
      const texas = await locations.resolve('Paris', 'us');
      const aliases = await ctx.prisma.locationAlias.findMany({ orderBy: { name: 'asc' } });
      expect(aliases).toEqual([
        { name: 'munchen', countryCode: '', locationId: munich.id },
        { name: 'paris', countryCode: 'US', locationId: texas.id },
      ]);
    });

    it('uses the best match for an ambiguous name and a country code to pick another', async () => {
      const france = await locations.resolve('Paris');
      const texas = await locations.resolve('Paris', 'us');
      expect(france.countryCode).toBe('FR');
      expect(texas).toMatchObject({ countryCode: 'US', region: 'Texas' });
      expect(texas.id).not.toBe(france.id);
      expect(await count()).toBe(2);
    });

    it('finds a city typed in Cyrillic: Минск is the capital of Belarus, not a Russian village', async () => {
      const minsk = await locations.resolve('Минск');
      expect(minsk).toMatchObject({ name: 'Минск', countryCode: 'BY', timezone: 'Europe/Minsk' });
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
          data: { name: 'innsbruck', countryCode: '', locationId: location.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('remembering when a place was last requested', () => {
    it('updates "last requested" at most once an hour, so reads do not turn into writes', async () => {
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
