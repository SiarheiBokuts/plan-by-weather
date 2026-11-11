import { readFileSync } from 'fs';
import { join } from 'path';
import { FetchFn } from '../../src/infrastructure/open-meteo/client/open-meteo.client';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8'));

export type Mode = 'ok' | 'rate-limited' | 'down' | 'network-error';

export interface FakeOpenMeteo {
  fetch: FetchFn;
  calls: { geocode: number; forecast: number; marine: number };
  urls: string[];
  mode: Mode;
  /** Value of the Retry-After header sent with 429 answers; undefined sends none */
  retryAfter?: string;
  /** Make only the marine host fail (forecast keeps working) */
  marineMode: Mode;
  reset(): void;
}

function geocodingResult(
  name: string,
  id: number,
  latitude: number,
  longitude: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    latitude,
    longitude,
    elevation: 500,
    feature_code: 'PPLA',
    country_code: 'AT',
    country: 'Austria',
    admin1: 'Test Region',
    timezone: 'Europe/Vienna',
    population: 100000,
    ...extra,
  };
}

/** City name (lowercase) -> recorded real geocoding answer in test/fixtures. */
const RECORDED_CITIES: Record<string, string> = {
  innsbruck: 'geocoding/innsbruck.json',
  munich: 'geocoding/munich.json',
  munchen: 'geocoding/munchen.json',
  biarritz: 'geocoding/biarritz.json',
  zermatt: 'geocoding/zermatt.json',
};

/**
 * Stands in for Open-Meteo: serves responses recorded from the real API (test/fixtures), counts calls,
 * and can be switched to rate-limited / down / network-error to exercise the failure paths.
 * Only `townN` names are made up: they resolve to a synthetic town, for tests that need many cities.
 */
export function createFakeOpenMeteo(): FakeOpenMeteo {
  const fake: FakeOpenMeteo = {
    calls: { geocode: 0, forecast: 0, marine: 0 },
    urls: [],
    mode: 'ok',
    marineMode: 'ok',
    retryAfter: undefined,
    reset() {
      fake.calls = { geocode: 0, forecast: 0, marine: 0 };
      fake.urls = [];
      fake.mode = 'ok';
      fake.marineMode = 'ok';
      fake.retryAfter = undefined;
    },
    fetch: async (url) => {
      const target = new URL(url);
      fake.urls.push(url);
      const kind = target.hostname.startsWith('geocoding')
        ? 'geocode'
        : target.hostname.startsWith('marine')
          ? 'marine'
          : 'forecast';
      fake.calls[kind] += 1;

      const mode = kind === 'marine' && fake.marineMode !== 'ok' ? fake.marineMode : fake.mode;
      if (mode === 'network-error') throw new Error('connect ECONNREFUSED');
      if (mode === 'down') return new Response('unavailable', { status: 503 });
      if (mode === 'rate-limited') {
        const headers: Record<string, string> = {};
        if (fake.retryAfter) headers['retry-after'] = fake.retryAfter;
        return new Response('{"reason":"Too many requests"}', { status: 429, headers });
      }

      return json(respond(kind, target));
    },
  };
  return fake;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(kind: 'geocode' | 'forecast' | 'marine', url: URL): unknown {
  if (kind === 'forecast') return fixture('forecast/innsbruck.json');
  if (kind === 'marine') {
    const coastal = Math.abs(Number(url.searchParams.get('latitude')) - 43.48) < 1;
    return fixture(coastal ? 'marine/biarritz-coastal.json' : 'marine/munich-inland.json');
  }

  const name = (url.searchParams.get('name') ?? '').toLowerCase();
  const countryCode = url.searchParams.get('countryCode');
  const synthetic = /^town(\d+)$/.exec(name);
  if (synthetic) {
    const n = Number(synthetic[1]);
    return { results: [geocodingResult(`Town${n}`, 900000 + n, 47 + n / 1000, 11 + n / 1000)] };
  }
  if (name === 'paris') {
    const paris = fixture('geocoding/paris.json') as { results: { country_code: string }[] };
    return countryCode
      ? { results: paris.results.filter((item) => item.country_code === countryCode) }
      : paris;
  }
  if (name === 'минск') {
    // Recorded from the real API: the answer depends on the requested language.
    return fixture(
      url.searchParams.get('language') === 'ru'
        ? 'geocoding/minsk-ru.json'
        : 'geocoding/minsk-en.json',
    );
  }
  if (RECORDED_CITIES[name]) return fixture(RECORDED_CITIES[name]);
  return fixture('geocoding/no-match.json');
}
