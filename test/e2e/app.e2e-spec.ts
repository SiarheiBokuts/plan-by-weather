/* eslint-disable @typescript-eslint/no-explicit-any -- GraphQL responses are dynamic JSON that each test narrows itself */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { APP_CONFIG, AppConfig } from '../../src/config/app-config';
import { FETCH_FN } from '../../src/infrastructure/open-meteo/client/open-meteo.client';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import { REDIS_CLIENT, RedisService } from '../../src/infrastructure/redis/redis.service';
import { testConfig } from '../support/builders';
import { FakeClock } from '../support/fake-clock';
import { createFakeOpenMeteo, FakeOpenMeteo } from '../support/fake-open-meteo';

const RANKING_QUERY = `
  query Ranking($city: String!, $countryCode: String) {
    activityRanking(city: $city, countryCode: $countryCode) {
      location { name country countryCode region latitude longitude elevationM timezone }
      meta { source fetchedAt nextRefreshAt outdated }
      byActivity {
        activity available unavailableReason score rating bestDay
        days { activity date available score rating rank summary reasons unavailableReason }
      }
      byDay {
        date bestActivity
        weather {
          date condition tempMaxC tempMinC precipitationMm snowfallCm snowDepthCm
          windMaxKmh waveHeightMaxM
        }
        activities { activity date available score rating summary reasons unavailableReason }
      }
    }
  }`;

interface GraphQLBody {
  data?: Record<string, any> | null;
  errors?: { message: string; extensions: Record<string, any> }[];
}

describe('GraphQL API (end to end: HTTP, GraphQL, Postgres, Redis; Open-Meteo is recorded)', () => {
  let app: INestApplication;
  let config: AppConfig;
  let clock: FakeClock;
  let fake: FakeOpenMeteo;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    clock = new FakeClock();
    fake = createFakeOpenMeteo();
    config = testConfig({ clientRateLimit: 1000, lockWaitMs: 500 });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(FETCH_FN)
      .useValue(fake.fetch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.locationAlias.deleteMany(),
      prisma.dailyWeather.deleteMany(),
      prisma.fetchState.deleteMany(),
      prisma.location.deleteMany(),
    ]);
    await redis.flushdb();
    fake.reset();
    clock.set('2026-11-11T10:00:00Z');
    config.clientRateLimit = 1000;
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const graphql = async (
    query: string,
    variables: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ): Promise<GraphQLBody> => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set(headers)
      .send({ query, variables });
    return response.body as GraphQLBody;
  };

  const ranking = async (city: string, countryCode?: string) =>
    graphql(RANKING_QUERY, { city, countryCode });

  describe('the ranking for a city', () => {
    it('returns the location, metadata, both views and a sentence for every day', async () => {
      const body = await ranking('Innsbruck');

      expect(body.errors).toBeUndefined();
      const result = body.data!.activityRanking;
      expect(result.location).toMatchObject({
        name: 'Innsbruck',
        countryCode: 'AT',
        timezone: 'Europe/Vienna',
      });
      expect(result.byActivity).toHaveLength(4);
      expect(result.byDay).toHaveLength(7);
      expect(result.byDay.map((d: { date: string }) => d.date)).toEqual([
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-14',
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
      ]);
      for (const day of result.byDay) {
        expect(day.activities).toHaveLength(4);
        expect(day.weather.condition).toEqual(expect.any(String));
        for (const activity of day.activities) {
          expect(activity.summary).toEqual(expect.any(String));
          expect(activity.summary.length).toBeGreaterThan(5);
        }
      }
    });

    it('orders activities best first and marks inland surfing as unavailable', async () => {
      const { activityRanking } = (await ranking('Innsbruck')).data!;
      const scores = activityRanking.byActivity.map((a: { score: number | null }) => a.score ?? -1);
      expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));

      const surfing = activityRanking.byActivity.find(
        (a: { activity: string }) => a.activity === 'SURFING',
      );
      expect(surfing).toMatchObject({
        available: false,
        unavailableReason: 'No wave data for this location',
        score: null,
        rating: null,
        bestDay: null,
      });
      expect(activityRanking.byActivity[3].activity).toBe('SURFING');
    });

    it('explains a rainy day in plain words, for outdoor and indoor plans', async () => {
      const { activityRanking } = (await ranking('Innsbruck')).data!;
      const rainy = activityRanking.byDay.find(
        (day: { date: string }) => day.date === '2026-11-13', // 7.9 mm in the recorded forecast
      );
      const activity = (name: string) =>
        rainy.activities.find((a: { activity: string }) => a.activity === name);

      expect(rainy.weather.precipitationMm).toBe(7.9);
      expect(activity('OUTDOOR_SIGHTSEEING')).toMatchObject({
        rating: 'POOR',
        summary: 'Rain (7.9 mm): not a day for walking around.',
      });
      expect(activity('INDOOR_SIGHTSEEING')).toMatchObject({
        rating: 'GREAT',
        summary: 'Rain (7.9 mm): a perfect day for museums and indoor plans.',
      });
      expect(rainy.bestActivity).toBe('INDOOR_SIGHTSEEING');
    });

    it('scores surfing for a coastal city', async () => {
      const { activityRanking } = (await ranking('Biarritz')).data!;
      const surfing = activityRanking.byActivity.find(
        (a: { activity: string }) => a.activity === 'SURFING',
      );
      expect(surfing.available).toBe(true);
      expect(surfing.score).toEqual(expect.any(Number));
      expect(surfing.bestDay).toMatch(/^2026-11-\d\d$/);
      expect(surfing.days[0].rank).toBeGreaterThanOrEqual(1);
      expect(activityRanking.byDay[0].weather.waveHeightMaxM).toBe(1.04);
    });

    it('understands a name typed in Cyrillic', async () => {
      const { activityRanking } = (await ranking('Минск')).data!;
      expect(activityRanking.location).toMatchObject({ name: 'Минск', countryCode: 'BY' });
    });

    it('picks the place named by the country code', async () => {
      const france = (await ranking('Paris')).data!.activityRanking.location;
      const texas = (await ranking('Paris', 'US')).data!.activityRanking.location;
      expect(france.countryCode).toBe('FR');
      expect(texas).toMatchObject({ countryCode: 'US', region: 'Texas' });
    });
  });

  describe('where the data comes from', () => {
    it('says OPEN_METEO the first time and DATABASE afterwards, with the same fetch time', async () => {
      const first = (await ranking('Innsbruck')).data!.activityRanking.meta;
      const second = (await ranking('Innsbruck')).data!.activityRanking.meta;

      expect(first.source).toBe('OPEN_METEO');
      expect(second.source).toBe('DATABASE');
      expect(second.fetchedAt).toBe(first.fetchedAt);
      expect(first.outdated).toBe(false);
      expect(new Date(first.nextRefreshAt).getTime() - new Date(first.fetchedAt).getTime()).toBe(
        6 * 3_600_000,
      );
      expect(fake.calls.forecast).toBe(1);
      expect(fake.calls.geocode).toBe(1);
    });

    it('refreshes after the interval', async () => {
      await ranking('Innsbruck');
      clock.advanceHours(7);
      const meta = (await ranking('Innsbruck')).data!.activityRanking.meta;
      expect(meta.source).toBe('OPEN_METEO');
      expect(fake.calls.forecast).toBe(2);
    });
  });

  describe('errors a user can understand', () => {
    it('LOCATION_NOT_FOUND for an unknown city', async () => {
      const body = await ranking('Atlantis');
      expect(body.data).toBeNull();
      expect(body.errors![0].extensions.code).toBe('LOCATION_NOT_FOUND');
      expect(body.errors![0].message).toContain('Atlantis');
    });

    it('BAD_USER_INPUT for a name that is too short, without calling Open-Meteo', async () => {
      const body = await ranking('P');
      expect(body.errors![0].extensions.code).toBe('BAD_USER_INPUT');
      expect(fake.calls.geocode).toBe(0);
    });

    it('BAD_USER_INPUT for a malformed country code', async () => {
      const body = await ranking('Paris', 'USA');
      expect(body.errors![0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('CLIENT_RATE_LIMITED after too many requests from one client, with a retry time', async () => {
      config.clientRateLimit = 2;
      await ranking('Innsbruck');
      await ranking('Innsbruck');
      const body = await ranking('Innsbruck');

      expect(body.errors![0].extensions).toMatchObject({ code: 'CLIENT_RATE_LIMITED' });
      expect(body.errors![0].extensions.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.errors![0].message).toMatch(/Too many requests\. Please try again in/);
    });

    it('counts clients separately, by API key', async () => {
      config.clientRateLimit = 1;
      const a = await graphql(RANKING_QUERY, { city: 'Innsbruck' }, { 'x-api-key': 'client-a' });
      const aAgain = await graphql(
        RANKING_QUERY,
        { city: 'Innsbruck' },
        { 'x-api-key': 'client-a' },
      );
      const b = await graphql(RANKING_QUERY, { city: 'Innsbruck' }, { 'x-api-key': 'client-b' });
      expect(a.errors).toBeUndefined();
      expect(aAgain.errors![0].extensions.code).toBe('CLIENT_RATE_LIMITED');
      expect(b.errors).toBeUndefined();
    });

    it('OPEN_METEO_RATE_LIMITED, with a friendly message and wait, for a new city', async () => {
      fake.mode = 'rate-limited';
      fake.retryAfter = '900';
      const body = await ranking('Biarritz');

      expect(body.data).toBeNull();
      expect(body.errors![0].extensions).toMatchObject({
        code: 'OPEN_METEO_RATE_LIMITED',
        retryAfterSeconds: 900,
      });
      expect(body.errors![0].message).toBe(
        "We can't load weather for this city right now. Please try again in about 15 minutes.",
      );
    });

    it('keeps answering for a known city while Open-Meteo is rate limiting, marked outdated', async () => {
      await ranking('Innsbruck');
      clock.advanceHours(7);
      fake.mode = 'rate-limited';
      fake.retryAfter = '600';

      const body = await ranking('Innsbruck');

      expect(body.errors).toBeUndefined();
      const meta = body.data!.activityRanking.meta;
      expect(meta).toMatchObject({ source: 'DATABASE', outdated: true });
      expect(new Date(meta.nextRefreshAt).getTime()).toBe(clock.now().getTime() + 600_000);
    });

    it('OPEN_METEO_UNAVAILABLE when Open-Meteo is down and nothing is stored', async () => {
      fake.mode = 'down';
      const body = await ranking('Biarritz');
      expect(body.errors![0].extensions.code).toBe('OPEN_METEO_UNAVAILABLE');
      expect(body.errors![0].message).not.toMatch(/503/);
    });
  });

  describe('searchLocations', () => {
    it('lists the matches for an ambiguous name, best first', async () => {
      const body = await graphql(
        `
          query ($q: String!, $cc: String) {
            searchLocations(query: $q, countryCode: $cc) {
              name
              countryCode
              region
            }
          }
        `,
        { q: 'Paris' },
      );
      const list = body.data!.searchLocations;
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list[0]).toMatchObject({ name: 'Paris', countryCode: 'FR' });
      expect(await prisma.location.count()).toBe(0);
    });

    it('can be narrowed by country', async () => {
      const body = await graphql(`
        query {
          searchLocations(query: "Paris", countryCode: "US") {
            countryCode
          }
        }
      `);
      const codes: string[] = body.data!.searchLocations.map(
        (l: { countryCode: string }) => l.countryCode,
      );
      expect(codes.every((c) => c === 'US')).toBe(true);
    });
  });

  describe('Apollo Sandbox', () => {
    it('is served at /graphql for browsers, also when running as in production', async () => {
      const response = await request(app.getHttpServer())
        .get('/graphql')
        .set('Accept', 'text/html');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toMatch(/sandbox/i);
    });

    it('documents the schema through introspection', async () => {
      const body = await graphql(`
        {
          __type(name: "ActivityRanking") {
            description
            fields {
              name
            }
          }
        }
      `);
      expect(body.data!.__type.fields.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining(['location', 'byActivity', 'byDay', 'meta']),
      );
    });
  });

  describe('GET /health', () => {
    it('reports a healthy stack', async () => {
      const response = await request(app.getHttpServer()).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
    });

    it('answers 503 when the database cannot be reached', async () => {
      jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));
      const response = await request(app.getHttpServer()).get('/health');
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ status: 'down', database: 'down' });
    });

    it('stays 200 but says degraded when only Redis is down', async () => {
      jest.spyOn(app.get(RedisService), 'status').mockResolvedValue('down');
      const response = await request(app.getHttpServer()).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'degraded', redis: 'down' });
    });
  });
});
