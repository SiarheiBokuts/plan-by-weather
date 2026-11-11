import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { normalizeQuery, onlySettlements } from './locations.service';

describe('normalizeQuery', () => {
  it('trims, collapses spaces and builds a case-insensitive key', () => {
    const query = normalizeQuery('  New   York ');
    expect(query).toEqual({ name: 'New York', countryCode: undefined, key: 'new york|' });
  });

  it('includes an upper-cased country code in the key', () => {
    expect(normalizeQuery('Paris', ' us ')).toEqual({
      name: 'Paris',
      countryCode: 'US',
      key: 'paris|US',
    });
  });

  it('treats a blank or missing country code as none', () => {
    expect(normalizeQuery('Paris', '').countryCode).toBeUndefined();
    expect(normalizeQuery('Paris', '  ').countryCode).toBeUndefined();
    expect(normalizeQuery('Paris', null).countryCode).toBeUndefined();
  });

  it('gives different keys to the same name in different countries', () => {
    expect(normalizeQuery('Paris').key).not.toBe(normalizeQuery('Paris', 'US').key);
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
