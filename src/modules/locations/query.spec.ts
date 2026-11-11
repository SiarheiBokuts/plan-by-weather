import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { normalizeQuery, onlySettlements } from './locations.service';

describe('normalizeQuery', () => {
  it('trims, collapses spaces and remembers the name in lower case, with no country', () => {
    const query = normalizeQuery('  New   York ');
    expect(query).toEqual({
      name: 'New York',
      countryCode: undefined,
      alias: { name: 'new york', countryCode: '' },
    });
  });

  it('remembers an upper-cased country code with the name', () => {
    expect(normalizeQuery('Paris', ' us ')).toEqual({
      name: 'Paris',
      countryCode: 'US',
      alias: { name: 'paris', countryCode: 'US' },
    });
  });

  it('treats a blank or missing country code as none', () => {
    expect(normalizeQuery('Paris', '').countryCode).toBeUndefined();
    expect(normalizeQuery('Paris', '  ').countryCode).toBeUndefined();
    expect(normalizeQuery('Paris', null).countryCode).toBeUndefined();
  });

  it('keeps the same name in different countries apart', () => {
    expect(normalizeQuery('Paris').alias).toEqual({ name: 'paris', countryCode: '' });
    expect(normalizeQuery('Paris', 'US').alias).toEqual({ name: 'paris', countryCode: 'US' });
  });

  it('treats upper and lower case, and extra spaces, as the same name', () => {
    expect(normalizeQuery(' MUNCHEN ').alias).toEqual(normalizeQuery('munchen').alias);
  });

  it.each(['', ' ', 'P', ' x '])('rejects too short input "%s"', (input) => {
    expect(() => normalizeQuery(input)).toThrow(/at least 2 characters/);
  });

  it('rejects very long input', () => {
    expect(() => normalizeQuery('a'.repeat(101))).toThrow(/limited to 100 characters/);
  });

  it.each(['USA', 'U', '1A', 'U$'])('rejects a malformed country code "%s"', (code) => {
    expect(() => normalizeQuery('Paris', code)).toThrow(/2-letter ISO country code/);
  });
});

describe('onlySettlements', () => {
  const result = (name: string, featureCode: string | null): GeocodeResult => ({
    id: 1,
    name,
    country: null,
    countryCode: null,
    region: null,
    latitude: 0,
    longitude: 0,
    elevation: null,
    timezone: 'UTC',
    population: null,
    featureCode,
  });

  it('keeps towns and cities and drops airports and unknown features', () => {
    const kept = onlySettlements([
      result('Airport', 'AIRH'),
      result('Town', 'PPL'),
      result('Capital', 'PPLC'),
      result('Mystery', null),
    ]);
    expect(kept.map((r) => r.name)).toEqual(['Town', 'Capital']);
  });
});
