import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import {
  buildClientSchema,
  getIntrospectionQuery,
  GraphQLSchema,
  isObjectType,
  getNamedType,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { APP_CONFIG } from '../../src/config/app-config';
import { FETCH_FN } from '../../src/infrastructure/open-meteo/client/open-meteo.client';
import { SANDBOX_DOCUMENT, SANDBOX_VARIABLES } from '../../src/sandbox-sample';
import { testConfig } from '../support/builders';
import { FakeClock } from '../support/fake-clock';
import { createFakeOpenMeteo } from '../support/fake-open-meteo';

describe('The ready-made operations that Apollo Sandbox shows', () => {
  let app: INestApplication;
  let schema: GraphQLSchema;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig({ sandboxEnabled: true }))
      .overrideProvider(Clock)
      .useValue(new FakeClock())
      .overrideProvider(FETCH_FN)
      .useValue(createFakeOpenMeteo().fetch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const introspection = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: getIntrospectionQuery() });
    schema = buildClientSchema(introspection.body.data);
  });
  afterAll(() => app.close());

  const run = (operationName: string, variables: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query: SANDBOX_DOCUMENT, operationName, variables });

  it('has one operation for every query the API offers', () => {
    const operations = parse(SANDBOX_DOCUMENT).definitions.flatMap((definition) =>
      definition.kind === 'OperationDefinition' ? [definition] : [],
    );
    const queriedFields = operations.flatMap((operation) =>
      operation.selectionSet.selections.map((selection) =>
        selection.kind === 'Field' ? selection.name.value : '',
      ),
    );
    const queryType = schema.getQueryType();
    expect(queryType).toBeDefined();
    expect(queriedFields.sort()).toEqual(Object.keys(queryType!.getFields()).sort());
  });

  it('selects every field of every answer, so a new field cannot be forgotten', () => {
    // Every "Type.field" that exists below the Query type...
    const expected = new Set<string>();
    const seen = new Set<string>();
    const collect = (typeName: string): void => {
      if (seen.has(typeName)) return;
      seen.add(typeName);
      const type = schema.getType(typeName);
      if (!isObjectType(type)) return;
      for (const [name, field] of Object.entries(type.getFields())) {
        expected.add(`${typeName}.${name}`);
        collect(getNamedType(field.type).name);
      }
    };
    collect(schema.getQueryType()!.name);

    // ...against every "Type.field" the sample document asks for.
    const asked = new Set<string>();
    const typeInfo = new TypeInfo(schema);
    visit(
      parse(SANDBOX_DOCUMENT),
      visitWithTypeInfo(typeInfo, {
        Field(node) {
          asked.add(`${typeInfo.getParentType()?.name}.${node.name.value}`);
        },
      }),
    );

    expect([...expected].filter((field) => !asked.has(field))).toEqual([]);
  });

  it('runs the Ranking operation with its starting variables', async () => {
    const response = await run('Ranking', SANDBOX_VARIABLES);
    expect(response.body.errors).toBeUndefined();
    const ranking = response.body.data.activityRanking;
    expect(ranking.location.name).toBe('Innsbruck');
    expect(ranking.byActivity).toHaveLength(4);
    expect(ranking.byDay).toHaveLength(7);
    expect(ranking.meta).toHaveProperty('outdated', false);
  });

  it('runs the SearchLocations operation with its starting variables', async () => {
    const response = await run('SearchLocations', SANDBOX_VARIABLES);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.searchLocations[0]).toMatchObject({ name: 'Paris' });
  });

  it('accepts a country code in both operations', async () => {
    const variables = { ...SANDBOX_VARIABLES, countryCode: 'US' };
    const search = await run('SearchLocations', variables);
    expect(
      search.body.data.searchLocations.every(
        (l: { countryCode: string }) => l.countryCode === 'US',
      ),
    ).toBe(true);
  });

  it('is described in the README, so documentation cannot miss a call', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8');
    for (const name of Object.keys(schema.getQueryType()!.getFields())) {
      expect(readme).toContain(`**\`${name}\`**`);
    }
    expect(readme).toContain('GET /health');
  });

  it('is what the browser page is pre-filled with', async () => {
    const page = await request(app.getHttpServer()).get('/graphql').set('Accept', 'text/html');
    expect(page.text).toContain('SearchLocations');
    expect(page.text).toContain('outdated');
  });
});
