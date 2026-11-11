import { readFileSync } from 'fs';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { Clock } from '../../src/common/clock';
import { APP_CONFIG, AppConfig } from '../../src/config/app-config';
import { FETCH_FN } from '../../src/infrastructure/open-meteo/client/open-meteo.client';
import { testConfig } from '../support/builders';
import { FakeClock } from '../support/fake-clock';
import { createFakeOpenMeteo } from '../support/fake-open-meteo';

async function startApp(config: AppConfig): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(Clock)
    .useValue(new FakeClock())
    .overrideProvider(FETCH_FN)
    .useValue(createFakeOpenMeteo().fetch)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, config);
  await app.init();
  return app;
}

const page = readFileSync(join(__dirname, '../../public/index.html'), 'utf8');
/** The GraphQL documents the page sends, marked in the HTML as GQL:name ... END. */
const queries = Object.fromEntries(
  [...page.matchAll(/\/\*GQL:(\w+)\*\/`([^`]*)`\/\*END\*\//g)].map((m) => [m[1], m[2]]),
);

describe('The optional test UI (UI_ENABLED=true)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await startApp(testConfig({ uiEnabled: true }));
  });
  afterAll(() => app.close());

  it('is served at /ui/ and mentions that it is an extra', async () => {
    const response = await request(app.getHttpServer()).get('/ui/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('Plan by weather');
    expect(response.text).toContain('TEST UI');
  });

  it('opens from the bare address too', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/ui/');
  });

  it('brings its own copy of Vue, so it works without internet', async () => {
    const response = await request(app.getHttpServer()).get('/ui/vendor/vue.global.prod.js');
    expect(response.status).toBe(200);
    expect(response.text).toContain('@license MIT');
  });

  it('brings its own styling library and icons, so it also works offline', async () => {
    const response = await request(app.getHttpServer()).get('/ui/vendor/tailwindcss-browser.js');
    expect(response.status).toBe(200);
    expect(page).toContain('vendor/tailwindcss-browser.js');
    expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org)[^"'\s]*\.(js|css)/); // nothing loaded from a CDN
    expect(page).toContain('const ICONS');
  });

  it('is light by default, can switch to dark, remembers the choice, and uses no gradients', () => {
    expect(page).toContain('html { color-scheme: light; }');
    expect(page).toContain("localStorage.getItem('theme') === 'dark'");
    expect(page).toContain("localStorage.setItem('theme'");
    expect(page).toContain('toggleTheme');
    expect(page).not.toMatch(/gradient/i);
  });

  it('explains every score with its conditions, points and what limited it', () => {
    expect(queries.ranking).toContain(
      'breakdown { points limitedBy factors { label value mark weight points limit } }',
    );
    expect(page).toContain('Why {{ x.score }}?');
    expect(page).toContain('Points added up');
    expect(page).toContain('x.breakdown.limitedBy');
  });

  it('only sends GraphQL documents that the API accepts', async () => {
    expect(Object.keys(queries).sort()).toEqual(['ranking', 'search']);

    const ranking = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: queries.ranking, variables: { city: 'Innsbruck', countryCode: null } });
    expect(ranking.body.errors).toBeUndefined();
    expect(ranking.body.data.activityRanking.byDay).toHaveLength(7);

    const search = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: queries.search, variables: { query: 'Paris', countryCode: null } });
    expect(search.body.errors).toBeUndefined();
    expect(search.body.data.searchLocations[0]).toMatchObject({ name: 'Paris' });
  });

  it('shows an icon for every activity and a colour for every rating, and every icon it names exists', () => {
    for (const activity of ['OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING', 'SKIING', 'SURFING']) {
      expect(page).toContain(`${activity}: { icon: '`);
    }
    for (const rating of ['GREAT', 'GOOD', 'FAIR', 'POOR']) {
      expect(page).toContain(`${rating}: 'var(--${rating.toLowerCase()})'`);
    }
    const defined = new Set([...page.matchAll(/^ {2}"([a-z-]+)": "/gm)].map((m) => m[1]));
    const used = [...page.matchAll(/icon: '([a-z-]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('has an icon for every weather condition the API can return', () => {
    const conditions = [
      'Clear sky',
      'Mostly clear',
      'Partly cloudy',
      'Overcast',
      'Fog',
      'Drizzle',
      'Rain',
      'Rain showers',
      'Snow',
      'Snow showers',
      'Thunderstorm',
    ];
    for (const condition of conditions) expect(page).toContain(`'${condition}': { icon: '`);
  });
});

describe('The optional test UI (UI_ENABLED unset, the default)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await startApp(testConfig({ uiEnabled: false }));
  });
  afterAll(() => app.close());

  it('is not served', async () => {
    expect((await request(app.getHttpServer()).get('/ui/')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/')).status).toBe(404);
  });
});
