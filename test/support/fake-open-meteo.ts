import { readFileSync } from 'fs';
import { join } from 'path';
import { FetchFn } from '../../src/open-meteo/open-meteo.client';

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

const KNOWN_CITIES: Record<string, Record<string, unknown>[]> = {
  innsbruck: [geocodingResult('Innsbruck', 2775220, 47.26, 11.39)],
  munich: [
    geocodingResult('Munich', 2867714, 48.14, 11.58, {
      country_code: 'DE',
      country: 'Germany',
      timezone: 'Europe/Berlin',
    }),
  ],
  munchen: [
    geocodingResult('Munich', 2867714, 48.14, 11.58, {
      country_code: 'DE',
      country: 'Germany',
      timezone: 'Europe/Berlin',
    }),
  ],
  biarritz: [
    geocodingResult('Biarritz', 3033405, 43.48, -1.56, {
      country_code: 'FR',
      country: 'France',
      timezone: 'Europe/Paris',
    }),
  ],
};

/**
 * Stands in for Open-Meteo: serves the recorded responses from test/fixtures, counts calls, and
 * can be switched to rate-limited / down / network-error to exercise the failure paths.
 * `townN` names resolve to a synthetic town, handy for tests that need many distinct cities.
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
  if (kind === 'forecast') return fixture('forecast-innsbruck.json');
  if (kind === 'marine') {
    const coastal = Math.abs(Number(url.searchParams.get('latitude')) - 43.48) < 1;
    return fixture(coastal ? 'marine-biarritz-coastal.json' : 'marine-munich-inland.json');
  }

  const name = (url.searchParams.get('name') ?? '').toLowerCase();
  const countryCode = url.searchParams.get('countryCode');
  const synthetic = /^town(\d+)$/.exec(name);
  if (synthetic) {
    const n = Number(synthetic[1]);
    return { results: [geocodingResult(`Town${n}`, 900000 + n, 47 + n / 1000, 11 + n / 1000)] };
  }
  if (name === 'paris') {
    const paris = fixture('geocoding-paris.json') as { results: { country_code: string }[] };
    return countryCode
      ? { results: paris.results.filter((item) => item.country_code === countryCode) }
      : paris;
  }
  if (name === 'zermatt') return fixture('geocoding-zermatt.json');
  if (KNOWN_CITIES[name]) return { results: KNOWN_CITIES[name] };
  return fixture('geocoding-no-match.json');
}
