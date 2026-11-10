import { AppConfig, loadConfig } from '../../src/config/app-config';
import { DailyWeatherData } from '../../src/weather/daily-weather';

/** A mild, dry, calm day with no snow and no wave data. Override only what a test cares about. */
export function dayOf(overrides: Partial<DailyWeatherData> = {}): DailyWeatherData {
  return {
    date: '2026-11-10',
    tempMaxC: 20,
    tempMinC: 11,
    apparentTempMaxC: 20,
    precipitationMm: 0,
    precipitationProbability: 5,
    snowfallCm: 0,
    snowDepthCm: 0,
    windMaxKmh: 10,
    gustMaxKmh: 18,
    weatherCode: 1,
    sunshineSeconds: 8 * 3600,
    uvIndexMax: 3,
    cloudCoverMeanPct: 20,
    waveHeightMaxM: null,
    wavePeriodMaxS: null,
    ...overrides,
  };
}

/** Test configuration: real env for the database and Redis, short waits, tiny limits. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig(process.env), lockWaitMs: 1500, ...overrides };
}
