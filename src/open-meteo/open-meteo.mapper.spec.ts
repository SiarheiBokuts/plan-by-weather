import { readFileSync } from 'fs';
import { join } from 'path';
import { parseForecast, parseGeocoding, parseMarine } from './open-meteo.mapper';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '../../test/fixtures', name), 'utf8'));

describe('parseGeocoding (recorded responses)', () => {
  it('returns every match of an ambiguous name with its details', () => {
    const results = parseGeocoding(fixture('geocoding-paris.json'));
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results[0]).toMatchObject({
      name: 'Paris',
      countryCode: 'FR',
      timezone: 'Europe/Paris',
      featureCode: expect.stringMatching(/^PPL/),
    });
    expect(results.map((r) => r.countryCode)).toEqual(expect.arrayContaining(['FR', 'US']));
    expect(results[0].latitude).toBeCloseTo(48.85, 1);
  });

  it('keeps non-settlement features so the caller can filter them', () => {
    const results = parseGeocoding(fixture('geocoding-zermatt.json'));
    expect(results.some((r) => r.featureCode === 'AIRH')).toBe(true);
  });

  it('treats a response without a results field as no match', () => {
    expect(parseGeocoding(fixture('geocoding-no-match.json'))).toEqual([]);
  });

  it('skips malformed entries and fills in defaults for optional fields', () => {
    const results = parseGeocoding({
      results: [
        { id: 1, name: 'Good', latitude: 1, longitude: 2 },
        { name: 'No id', latitude: 1, longitude: 2 },
        { id: 3, name: '', latitude: 1, longitude: 2 },
        { id: 4, name: 'No coordinates' },
        'not an object',
      ],
    });
    expect(results).toEqual([
      {
        id: 1,
        name: 'Good',
        country: null,
        countryCode: null,
        region: null,
        latitude: 1,
        longitude: 2,
        elevation: null,
        timezone: 'UTC',
        population: null,
        featureCode: null,
      },
    ]);
  });

  it('copes with a non-object payload', () => {
    expect(parseGeocoding(null)).toEqual([]);
    expect(parseGeocoding('nope')).toEqual([]);
  });
});

describe('parseForecast (recorded Innsbruck response)', () => {
  const forecast = parseForecast(fixture('forecast-innsbruck.json'));

  it('returns 7 local dates with the location time zone and elevation', () => {
    expect(forecast.days).toHaveLength(7);
    expect(forecast.days[0].date).toBe('2026-11-10');
    expect(forecast.days[6].date).toBe('2026-11-16');
    expect(forecast.timezone).toBe('Europe/Vienna');
    expect(forecast.elevation).toBe(584);
  });

  it('maps the daily values to our fields', () => {
    expect(forecast.days[0]).toMatchObject({
      tempMaxC: 11.9,
      tempMinC: 5.3,
      precipitationMm: 0.8,
      snowfallCm: 0,
      windMaxKmh: 8.1,
      gustMaxKmh: 17.6,
      weatherCode: 61,
      uvIndexMax: 1.3,
    });
  });

  it('has no wave data until the marine response is merged', () => {
    expect(forecast.days.every((d) => d.waveHeightMaxM === null)).toBe(true);
  });

  it('turns hourly snow depth in metres into a daily maximum in centimetres', () => {
    const payload = {
      timezone: 'UTC',
      daily: { time: ['2026-01-01', '2026-01-02'] },
      hourly: {
        time: ['2026-01-01T00:00', '2026-01-01T12:00', '2026-01-02T00:00'],
        snow_depth: [0.1, 0.35, 0.2],
      },
    };
    const days = parseForecast(payload).days;
    expect(days[0].snowDepthCm).toBeCloseTo(35, 5);
    expect(days[1].snowDepthCm).toBeCloseTo(20, 5);
  });

  it('leaves snow depth null when there is no hourly data for the day', () => {
    const days = parseForecast({ daily: { time: ['2026-01-01'] } }).days;
    expect(days[0].snowDepthCm).toBeNull();
  });

  it('ignores hourly entries that are not usable', () => {
    const days = parseForecast({
      daily: { time: ['2026-01-01'] },
      hourly: { time: [123, '2026-01-01T00:00'], snow_depth: [0.5, null] },
    }).days;
    expect(days[0].snowDepthCm).toBeNull();
  });

  it('rounds the weather code and turns missing values into null', () => {
    const days = parseForecast({
      daily: { time: ['2026-01-01'], weather_code: [3.0], temperature_2m_max: [null] },
    }).days;
    expect(days[0].weatherCode).toBe(3);
    expect(days[0].tempMaxC).toBeNull();
    expect(days[0].windMaxKmh).toBeNull();
  });

  it('falls back to UTC and no elevation when the response omits them', () => {
    const result = parseForecast({ daily: { time: ['2026-01-01'] } });
    expect(result.timezone).toBe('UTC');
    expect(result.elevation).toBeNull();
  });

  it.each([null, {}, { daily: {} }, { daily: { time: [] } }, 'garbage'])(
    'reports an unusable response as the service being unavailable (%j)',
    (payload) => {
      expect(() => parseForecast(payload)).toThrow(/not reachable/);
    },
  );
});

describe('parseMarine (recorded responses)', () => {
  it('returns wave height and period for a coastal point', () => {
    const days = parseMarine(fixture('marine-biarritz-coastal.json'));
    expect(days).toHaveLength(7);
    expect(days![0]).toMatchObject({
      date: '2026-11-10',
      waveHeightMaxM: 0.86,
      wavePeriodMaxS: 11.5,
    });
  });

  it('returns null for an inland point, where every value is null', () => {
    expect(parseMarine(fixture('marine-munich-inland.json'))).toBeNull();
  });

  it('returns null for an empty or malformed payload', () => {
    expect(parseMarine({})).toBeNull();
    expect(parseMarine(null)).toBeNull();
  });

  it('keeps days with partial data when at least one wave height exists', () => {
    const days = parseMarine({
      daily: { time: ['a', 'b'], wave_height_max: [null, 1.2], wave_period_max: [null, null] },
    });
    expect(days).toEqual([
      { date: 'a', waveHeightMaxM: null, wavePeriodMaxS: null },
      { date: 'b', waveHeightMaxM: 1.2, wavePeriodMaxS: null },
    ]);
  });
});
