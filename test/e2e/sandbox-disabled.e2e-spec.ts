import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { APP_CONFIG } from '../../src/config/app-config';
import { FETCH_FN } from '../../src/infrastructure/open-meteo/client/open-meteo.client';
import { testConfig } from '../support/builders';
import { FakeClock } from '../support/fake-clock';
import { createFakeOpenMeteo } from '../support/fake-open-meteo';

describe('With Apollo Sandbox switched off (GRAPHQL_SANDBOX unset: the default, meant for production)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig({ sandboxEnabled: false }))
      .overrideProvider(Clock)
      .useValue(new FakeClock())
      .overrideProvider(FETCH_FN)
      .useValue(createFakeOpenMeteo().fetch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('serves no explorer page at /graphql', async () => {
    const response = await request(app.getHttpServer()).get('/graphql').set('Accept', 'text/html');
    expect(response.text).not.toMatch(/sandbox/i);
    expect(response.headers['content-type']).not.toMatch(/text\/html/);
  });

  it('refuses to describe the schema (introspection is off)', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ __schema { queryType { name } } }' });
    expect(response.body.errors?.[0].message).toMatch(/introspection/i);
    expect(response.body.data).toBeUndefined();
  });

  it('still answers normal queries from programs', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ searchLocations(query: "Paris") { name countryCode } }' });
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.searchLocations[0]).toMatchObject({ name: 'Paris' });
  });
});
