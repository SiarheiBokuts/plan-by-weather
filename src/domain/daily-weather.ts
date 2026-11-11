/** One day of normalized weather for a location. Units: Celsius, mm, cm, km/h, seconds, metres. */
export interface DailyWeatherData {
  /** Local calendar date of the location, YYYY-MM-DD */
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  apparentTempMaxC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  snowfallCm: number | null;
  /** Deepest snow on the ground during the day */
  snowDepthCm: number | null;
  windMaxKmh: number | null;
  gustMaxKmh: number | null;
  /** WMO weather interpretation code */
  weatherCode: number | null;
  sunshineSeconds: number | null;
  uvIndexMax: number | null;
  cloudCoverMeanPct: number | null;
  waveHeightMaxM: number | null;
  wavePeriodMaxS: number | null;
}

/** WMO weather code to a short plain-English condition. */
export function describeWeatherCode(code: number | null): string {
  if (code === null) return 'Unknown';
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

export function isThunderstorm(code: number | null): boolean {
  return code !== null && code >= 95;
}
