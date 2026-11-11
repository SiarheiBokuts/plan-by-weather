import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../common/clock';
import { OpenMeteoRateLimitedError, OpenMeteoUnavailableError } from '../../../common/errors';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { parseForecast, parseGeocoding, parseMarine } from './open-meteo.mapper';
import { ForecastData, GeocodeResult, MarineDay } from '../open-meteo.types';
import { retryAfterSeconds, UpstreamGate } from '../upstream-gate/upstream-gate.service';

/** Injection token for the HTTP function, so tests can serve recorded responses. */
export const FETCH_FN = Symbol('FETCH_FN');
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Only the fields the scorers use: cost grows with the number of requested variables. */
const DAILY_FIELDS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'weather_code',
  'sunshine_duration',
  'uv_index_max',
  'cloud_cover_mean',
].join(',');

const MARINE_FIELDS = 'wave_height_max,wave_period_max';

/**
 * The geocoder matches names in the language it is asked to answer in: "Минск" finds Minsk only with
 * language=ru (with language=en it finds a village called Minskoye). So the language follows the
 * alphabet of what the user typed: Cyrillic means Russian, anything else English. Ukrainian and
 * Belarusian-only spellings are not recognised; Russian or Latin spellings are.
 */
export function geocodingLanguage(name: string): 'ru' | 'en' {
  return /\p{Script=Cyrillic}/u.test(name) ? 'ru' : 'en';
}

@Injectable()
export class OpenMeteoClient {
  private readonly logger = new Logger(OpenMeteoClient.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FETCH_FN) private readonly fetchFn: FetchFn,
    private readonly gate: UpstreamGate,
    private readonly clock: Clock,
  ) {}

  async geocode(name: string, countryCode?: string, count = 5): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({
      name,
      count: String(count),
      language: geocodingLanguage(name),
    });
    if (countryCode) params.set('countryCode', countryCode);
    return parseGeocoding(
      await this.getJson('geocoding', `${this.config.openMeteo.geocodingUrl}?${params}`),
    );
  }

  async forecast(latitude: number, longitude: number): Promise<ForecastData> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: DAILY_FIELDS,
      hourly: 'snow_depth',
      forecast_days: '7',
      timezone: 'auto',
    });
    return parseForecast(
      await this.getJson('forecast', `${this.config.openMeteo.forecastUrl}?${params}`),
    );
  }

  /** Returns null when Open-Meteo has no wave data for the point (for example inland cities). */
  async marine(latitude: number, longitude: number): Promise<MarineDay[] | null> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: MARINE_FIELDS,
      forecast_days: '7',
      timezone: 'auto',
    });
    return parseMarine(
      await this.getJson('marine', `${this.config.openMeteo.marineUrl}?${params}`),
    );
  }

  /**
   * One GET with a timeout and a single immediate retry on network errors and 5xx.
   * Never calls out while the gate is paused; a 429 pauses the gate for everyone.
   * Plain fetch: a retry library would add a dependency for 15 lines.
   */
  private async getJson(what: 'geocoding' | 'forecast' | 'marine', url: string): Promise<unknown> {
    await this.gate.assertOpen();
    let lastProblem = 'unknown error';
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = this.clock.now().getTime();
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.config.openMeteo.timeoutMs),
        });
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Open-Meteo ${what} failed (${lastProblem})${attempt === 0 ? ', trying once more' : ''}`,
        );
        continue;
      }
      const took = `${this.clock.now().getTime() - started} ms`;

      if (response.status === 429) {
        const seconds = await this.gate.pause(
          retryAfterSeconds(response.headers, this.clock.now()),
        );
        this.logger.warn(
          `Open-Meteo ${what} answered 429 (too many requests, ${took}); pausing all calls for ${seconds}s`,
        );
        throw new OpenMeteoRateLimitedError(seconds);
      }
      if (response.status >= 500) {
        lastProblem = `HTTP ${response.status}`;
        this.logger.warn(
          `Open-Meteo ${what} answered ${response.status} (${took})${attempt === 0 ? ', trying once more' : ''}`,
        );
        continue;
      }
      if (!response.ok) {
        throw new OpenMeteoUnavailableError(`HTTP ${response.status}`);
      }
      try {
        const body = await response.json();
        this.logger.log(`Open-Meteo ${what} answered ${response.status} in ${took}`);
        return body;
      } catch {
        throw new OpenMeteoUnavailableError('Response was not valid JSON');
      }
    }
    throw new OpenMeteoUnavailableError(lastProblem);
  }
}
