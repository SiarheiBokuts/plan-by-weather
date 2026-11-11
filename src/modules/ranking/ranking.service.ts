import { Injectable, Logger } from '@nestjs/common';
import { Location } from '@prisma/client';
import { Clock } from '../../common/clock';
import { DataSource } from '../../domain/data-source';
import { ForecastService, ForecastMeta } from '../forecast/forecast.service';
import { LocationsService } from '../locations/locations.service';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { ActivityOutlook, ActivityDayScore, ScoringService } from '../scoring/scoring.service';
import { Activity } from '../scoring/types';
import { DailyWeatherData, describeWeatherCode } from '../../domain/daily-weather';

/** A place as the API shows it (the GraphQL type in src/api/graphql/ranking.model.ts has the same shape). */
export interface LocationView {
  name: string;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
}

/** The weather of one day as the API shows it. */
export interface DayWeatherView {
  date: string;
  condition: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationMm: number | null;
  snowfallCm: number | null;
  snowDepthCm: number | null;
  windMaxKmh: number | null;
  waveHeightMaxM: number | null;
}

export interface DayOutlookView {
  date: string;
  weather: DayWeatherView;
  activities: ActivityDayScore[];
  bestActivity: Activity | null;
}

export interface RankingResult {
  location: LocationView;
  byActivity: ActivityOutlook[];
  byDay: DayOutlookView[];
  meta: ForecastMeta;
}

export function toLocationView(source: Location | GeocodeResult): LocationView {
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

export function toDayWeatherView(day: DailyWeatherData): DayWeatherView {
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

/** "just now", "12 min", "7 h 5 min": a duration in words for log lines. */
export function humanDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** Where the weather of a response came from, for the log: database or Open-Meteo, and how fresh it is. */
export function describeSource(meta: ForecastMeta, now: Date): string {
  if (meta.source === DataSource.OPEN_METEO) return 'weather just fetched from Open-Meteo';
  const age = humanDuration(now.getTime() - meta.fetchedAt.getTime());
  if (meta.outdated)
    return `OUTDATED weather from the database (fetched ${age} ago, refresh not possible)`;
  const until = humanDuration(meta.nextRefreshAt.getTime() - now.getTime());
  return `weather from the database (fetched ${age} ago, next refresh in ${until})`;
}

/** Orchestrates one request: resolve the city, get its weather, score it. No rules of its own. */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(
    private readonly locations: LocationsService,
    private readonly forecasts: ForecastService,
    private readonly scoring: ScoringService,
    private readonly clock: Clock,
  ) {}

  async rank(city: string, countryCode?: string | null): Promise<RankingResult> {
    const started = this.clock.now();
    const location = await this.locations.resolve(city, countryCode);
    const forecast = await this.forecasts.getForecast(location);
    const outlook = this.scoring.buildOutlook(forecast.days);
    const now = this.clock.now();
    this.logger.log(
      `Ranking "${city}"${countryCode ? ` (${countryCode})` : ''} -> ${location.name}, ${location.countryCode ?? '?'} | ` +
        `${describeSource(forecast.meta, now)} | ${now.getTime() - started.getTime()} ms`,
    );
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

  async search(query: string, countryCode?: string | null): Promise<LocationView[]> {
    const candidates = await this.locations.search(query, countryCode);
    this.logger.log(
      `Search "${query}"${countryCode ? ` (${countryCode})` : ''} -> ${candidates.length} place(s)`,
    );
    return candidates.map(toLocationView);
  }
}
