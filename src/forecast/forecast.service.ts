import { Inject, Injectable, Logger } from '@nestjs/common';
import { Location } from '@prisma/client';
import { Clock, localDate } from '../common/clock';
import { OpenMeteoRateLimitedError, OpenMeteoUnavailableError } from '../common/errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { OpenMeteoClient } from '../open-meteo/open-meteo.client';
import { ForecastData, MarineDay } from '../open-meteo/open-meteo.types';
import { UpstreamGate } from '../open-meteo/upstream-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DailyWeatherData } from '../weather/daily-weather';
import { DataSource } from '../weather/data-source';

const FORECAST_DAYS = 7;
const POLL_INTERVAL_MS = 100;

export interface ForecastMeta {
  source: DataSource;
  fetchedAt: Date;
  /** Earliest time a refresh can happen (end of the 6 hour interval, or end of a pause) */
  nextRefreshAt: Date;
  /** True when stored data is served because a refresh was not possible */
  stale: boolean;
}

export interface ForecastResult {
  days: DailyWeatherData[];
  meta: ForecastMeta;
}

type UpstreamError = OpenMeteoRateLimitedError | OpenMeteoUnavailableError;

function isUpstreamError(error: unknown): error is UpstreamError {
  return error instanceof OpenMeteoRateLimitedError || error instanceof OpenMeteoUnavailableError;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Merges wave data into the forecast days by date. */
export function mergeMarine(
  days: DailyWeatherData[],
  marine: MarineDay[] | null,
): DailyWeatherData[] {
  if (!marine) return days;
  const byDate = new Map(marine.map((day) => [day.date, day]));
  return days.map((day) => {
    const wave = byDate.get(day.date);
    return wave
      ? { ...day, waveHeightMaxM: wave.waveHeightMaxM, wavePeriodMaxS: wave.wavePeriodMaxS }
      : day;
  });
}

/**
 * Serves 7 days of weather for a location from the database, refreshing it from Open-Meteo at
 * most once per TTL. Order of preference: fresh stored data, then a refresh (one at a time per
 * location), then stale stored data, then an error.
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: OpenMeteoClient,
    private readonly gate: UpstreamGate,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getForecast(location: Location): Promise<ForecastResult> {
    const fresh = await this.readFresh(location);
    if (fresh) return fresh;

    const lockKey = `lock:location:${location.id}`;
    const token = await this.redis.acquireLock(lockKey, this.config.lockTtlMs);
    if (!token) return this.waitForOtherRefresh(location);

    try {
      // Someone may have finished a refresh between our first read and taking the lock.
      const again = await this.readFresh(location);
      if (again) return again;
      return await this.refresh(location);
    } finally {
      await this.redis.releaseLock(lockKey, token);
    }
  }

  private async refresh(location: Location): Promise<ForecastResult> {
    let forecast: ForecastData;
    let marine: MarineDay[] | null = null;
    let marineAvailable = location.marineAvailable;

    try {
      forecast = await this.client.forecast(location.latitude, location.longitude);
    } catch (error) {
      if (!isUpstreamError(error)) throw error;
      await this.recordError(location, error);
      return this.staleOrThrow(location, error);
    }

    // Wave data is a bonus: when it fails the forecast is still worth storing.
    // Locations known to have no wave data skip the call, which saves quota.
    if (location.marineAvailable !== false) {
      try {
        marine = await this.client.marine(location.latitude, location.longitude);
        marineAvailable = marine !== null;
      } catch (error) {
        if (!isUpstreamError(error)) throw error;
        this.logger.warn(`Wave data unavailable for location ${location.id}: ${error.message}`);
      }
    }

    const days = mergeMarine(forecast.days, marine).slice(0, FORECAST_DAYS);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.forecastTtlHours * 3_600_000);
    await this.persist(location, forecast, days, marineAvailable, now, expiresAt);

    return {
      days,
      meta: {
        source: DataSource.OPEN_METEO,
        fetchedAt: now,
        nextRefreshAt: expiresAt,
        stale: false,
      },
    };
  }

  private async persist(
    location: Location,
    forecast: ForecastData,
    days: DailyWeatherData[],
    marineAvailable: boolean | null,
    fetchedAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.dailyWeather.deleteMany({ where: { locationId: location.id } }),
      this.prisma.dailyWeather.createMany({
        data: days.map((day) => ({ ...day, locationId: location.id })),
      }),
      this.prisma.fetchState.upsert({
        where: { locationId: location.id },
        create: { locationId: location.id, fetchedAt, expiresAt },
        update: { fetchedAt, expiresAt, lastError: null, lastErrorAt: null },
      }),
      this.prisma.location.update({
        where: { id: location.id },
        data: { marineAvailable, elevation: forecast.elevation ?? location.elevation },
      }),
    ]);
  }

  private async readFresh(location: Location): Promise<ForecastResult | null> {
    const state = await this.prisma.fetchState.findUnique({ where: { locationId: location.id } });
    const now = this.clock.now();
    if (!state || state.expiresAt.getTime() <= now.getTime()) return null;
    const days = await this.loadDays(location, now);
    if (days.length < FORECAST_DAYS) return null;
    return {
      days,
      meta: {
        source: DataSource.DATABASE,
        fetchedAt: state.fetchedAt,
        nextRefreshAt: state.expiresAt,
        stale: false,
      },
    };
  }

  /** Stored days from today (in the location's time zone) onward. */
  private async loadDays(location: Location, now: Date): Promise<DailyWeatherData[]> {
    const rows = await this.prisma.dailyWeather.findMany({
      where: { locationId: location.id, date: { gte: localDate(now, location.timezone) } },
      orderBy: { date: 'asc' },
      take: FORECAST_DAYS,
    });
    return rows.map(({ locationId: _locationId, ...day }) => day);
  }

  /** Another request is refreshing this location: wait for its result instead of calling out. */
  private async waitForOtherRefresh(location: Location): Promise<ForecastResult> {
    const attempts = Math.ceil(this.config.lockWaitMs / POLL_INTERVAL_MS);
    for (let attempt = 0; attempt < attempts; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const fresh = await this.readFresh(location);
      if (fresh) return fresh;
    }
    return this.staleOrThrow(location, new OpenMeteoUnavailableError('Refresh in progress'));
  }

  private async staleOrThrow(location: Location, error: UpstreamError): Promise<ForecastResult> {
    const now = this.clock.now();
    const days = await this.loadDays(location, now);
    if (days.length === 0) throw error;

    const state = await this.prisma.fetchState.findUnique({ where: { locationId: location.id } });
    const pausedFor = await this.gate.remainingSeconds();
    const retryInSeconds = pausedFor ?? error.retryAfterSeconds;
    return {
      days,
      meta: {
        source: DataSource.DATABASE,
        fetchedAt: state?.fetchedAt ?? now,
        nextRefreshAt: new Date(now.getTime() + retryInSeconds * 1000),
        stale: true,
      },
    };
  }

  private async recordError(location: Location, error: UpstreamError): Promise<void> {
    await this.prisma.fetchState.updateMany({
      where: { locationId: location.id },
      data: { lastError: error.message, lastErrorAt: this.clock.now() },
    });
  }
}
