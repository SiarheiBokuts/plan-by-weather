import { OpenMeteoUnavailableError } from '../../../common/errors';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { ForecastData, GeocodeResult, MarineDay } from '../open-meteo.types';

// Small hand-written checks instead of a schema library (zod would also work): a missing number
// becomes null ("unknown") and the day is kept, rather than the whole response being rejected.
type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === 'object' ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function series(block: Json, name: string): unknown[] {
  return asArray(block[name]);
}

/** Geocoding answers with no `results` field at all when nothing matches. */
export function parseGeocoding(payload: unknown): GeocodeResult[] {
  const results = asArray(asObject(payload).results);
  const parsed: GeocodeResult[] = [];
  for (const raw of results) {
    const item = asObject(raw);
    const id = num(item.id);
    const latitude = num(item.latitude);
    const longitude = num(item.longitude);
    const name = str(item.name);
    if (id === null || latitude === null || longitude === null || name === null) continue;
    parsed.push({
      id,
      name,
      country: str(item.country),
      countryCode: str(item.country_code),
      region: str(item.admin1),
      latitude,
      longitude,
      elevation: num(item.elevation),
      timezone: str(item.timezone) ?? 'UTC',
      population: num(item.population),
      featureCode: str(item.feature_code),
    });
  }
  return parsed;
}

/** snow_depth only exists as hourly data (metres); reduce it to the daily maximum in cm. */
function dailySnowDepthCm(hourly: Json): Map<string, number> {
  const times = series(hourly, 'time');
  const depths = series(hourly, 'snow_depth');
  const maxima = new Map<string, number>();
  times.forEach((time, index) => {
    const depth = num(depths[index]);
    if (typeof time !== 'string' || depth === null) return;
    const date = time.slice(0, 10);
    const cm = depth * 100;
    const current = maxima.get(date);
    if (current === undefined || cm > current) maxima.set(date, cm);
  });
  return maxima;
}

export function parseForecast(payload: unknown): ForecastData {
  const root = asObject(payload);
  const daily = asObject(root.daily);
  const dates = series(daily, 'time');
  if (dates.length === 0) {
    throw new OpenMeteoUnavailableError('Unexpected forecast response: no daily data');
  }
  const snowDepth = dailySnowDepthCm(asObject(root.hourly));
  const at = (name: string, index: number): number | null => num(series(daily, name)[index]);

  const days: DailyWeatherData[] = dates.map((rawDate, index) => {
    const date = String(rawDate);
    const weatherCode = at('weather_code', index);
    return {
      date,
      tempMaxC: at('temperature_2m_max', index),
      tempMinC: at('temperature_2m_min', index),
      apparentTempMaxC: at('apparent_temperature_max', index),
      precipitationMm: at('precipitation_sum', index),
      precipitationProbability: at('precipitation_probability_max', index),
      snowfallCm: at('snowfall_sum', index),
      snowDepthCm: snowDepth.get(date) ?? null,
      windMaxKmh: at('wind_speed_10m_max', index),
      gustMaxKmh: at('wind_gusts_10m_max', index),
      weatherCode: weatherCode === null ? null : Math.round(weatherCode),
      sunshineSeconds: at('sunshine_duration', index),
      uvIndexMax: at('uv_index_max', index),
      cloudCoverMeanPct: at('cloud_cover_mean', index),
      waveHeightMaxM: null,
      wavePeriodMaxS: null,
    };
  });

  return { elevation: num(root.elevation), timezone: str(root.timezone) ?? 'UTC', days };
}

/**
 * Inland points answer HTTP 200 with all-null arrays. That means "no wave data here", so it
 * returns null instead of days full of nulls.
 */
export function parseMarine(payload: unknown): MarineDay[] | null {
  const daily = asObject(asObject(payload).daily);
  const dates = series(daily, 'time');
  const heights = series(daily, 'wave_height_max');
  const periods = series(daily, 'wave_period_max');
  const days: MarineDay[] = dates.map((date, index) => ({
    date: String(date),
    waveHeightMaxM: num(heights[index]),
    wavePeriodMaxS: num(periods[index]),
  }));
  return days.some((day) => day.waveHeightMaxM !== null) ? days : null;
}
