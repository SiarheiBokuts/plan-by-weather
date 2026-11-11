import { Injectable } from '@nestjs/common';
import { Location } from '@prisma/client';
import { ForecastService, ForecastMeta } from '../forecast/forecast.service';
import { LocationsService } from '../locations/locations.service';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { ActivityOutlook, ActivityDayScore, ScoringService } from '../scoring/scoring.service';
import { Activity } from '../scoring/types';
import { DailyWeatherData, describeWeatherCode } from '../../domain/daily-weather';
import { DayWeatherType, LocationType } from './ranking.types';

export interface DayOutlookView {
  date: string;
  weather: DayWeatherType;
  activities: ActivityDayScore[];
  bestActivity: Activity | null;
}

export interface RankingResult {
  location: LocationType;
  byActivity: ActivityOutlook[];
  byDay: DayOutlookView[];
  meta: ForecastMeta;
}

export function toLocationView(source: Location | GeocodeResult): LocationType {
  return {
    name: source.name,
    country: source.country,
    countryCode: source.countryCode,
    region: 'region' in source ? source.region : null,
    latitude: source.latitude,
    longitude: source.longitude,
    elevationM: source.elevation,
    timezone: source.timezone,
  };
}

export function toDayWeatherView(day: DailyWeatherData): DayWeatherType {
  return {
    date: day.date,
    condition: describeWeatherCode(day.weatherCode),
    tempMaxC: day.tempMaxC,
    tempMinC: day.tempMinC,
    precipitationMm: day.precipitationMm,
    snowfallCm: day.snowfallCm,
    snowDepthCm: day.snowDepthCm,
    windMaxKmh: day.windMaxKmh,
    waveHeightMaxM: day.waveHeightMaxM,
  };
}

/** Orchestrates one request: resolve the city, get its weather, score it. No rules of its own. */
@Injectable()
export class RankingService {
  constructor(
    private readonly locations: LocationsService,
    private readonly forecasts: ForecastService,
    private readonly scoring: ScoringService,
  ) {}

  async rank(city: string, countryCode?: string | null): Promise<RankingResult> {
    const location = await this.locations.resolve(city, countryCode);
    const forecast = await this.forecasts.getForecast(location);
    const outlook = this.scoring.buildOutlook(forecast.days);
    return {
      location: toLocationView(location),
      byActivity: outlook.byActivity,
      byDay: outlook.byDay.map((day) => ({
        date: day.date,
        weather: toDayWeatherView(day.weather),
        activities: day.activities,
        bestActivity: day.bestActivity,
      })),
      meta: forecast.meta,
    };
  }

  async search(query: string, countryCode?: string | null): Promise<LocationType[]> {
    const candidates = await this.locations.search(query, countryCode);
    return candidates.map(toLocationView);
  }
}
