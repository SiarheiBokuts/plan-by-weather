import { DailyWeatherData } from '../../domain/daily-weather';

export interface GeocodeResult {
  /** The geocoder's own id; used as the stable key of a stored location */
  id: number;
  name: string;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
  timezone: string;
  population: number | null;
  /** GeoNames feature code; populated places start with "PPL" */
  featureCode: string | null;
}

export interface ForecastData {
  elevation: number | null;
  timezone: string;
  days: DailyWeatherData[];
}

export interface MarineDay {
  date: string;
  waveHeightMaxM: number | null;
  wavePeriodMaxS: number | null;
}
