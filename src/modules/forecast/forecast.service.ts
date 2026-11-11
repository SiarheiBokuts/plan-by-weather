import { Inject, Injectable, Logger } from '@nestjs/common';
import { Location } from '@prisma/client';
import { Clock, localDate } from '../../common/clock';
import { OpenMeteoRateLimitedError, OpenMeteoUnavailableError } from '../../common/errors';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { OpenMeteoClient } from '../../infrastructure/open-meteo/client/open-meteo.client';
import { ForecastData, MarineDay } from '../../infrastructure/open-meteo/open-meteo.types';
import { UpstreamGate } from '../../infrastructure/open-meteo/upstream-gate/upstream-gate.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DailyWeatherData } from '../../domain/daily-weather';
import { DataSource } from '../../domain/data-source';
import { ForecastRepository } from './forecast.repository';

const FORECAST_DAYS = 7;

export interface ForecastMeta {
  source: DataSource;
  fetchedAt: Date;
  /** Earliest time a refresh can happen (end of the 6 hour interval, or end of a pause) */
  nextRefreshAt: Date;
  /** True when stored data is served because a refresh was not possible */
  outdated: boolean;
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
 * BUSINESS LOGIC for weather: serves 7 days for a location from storage, refreshing it from
 * Open-Meteo at most once per TTL. Reads and writes go through the repository, outside data through
 * the Open-Meteo client, and the one-refresh-at-a-time lock through Redis.
 *
 * Order of preference: fresh stored data, then a refresh (one at a time per location), then
 * outdated stored data, then an error.
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly repository: ForecastRepository,
    private readonly client: OpenMeteoClient,
    private readonly gate: UpstreamGate,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getForecast(location: Location): Promise<ForecastResult> {
    const fresh = await this.readFresh(location);
    if (fresh) return fresh;

    // One refresh per city at a time, so ten requests cost one Open-Meteo call. A Redis lock (works
    // across instances) rather than a promise map (one instance only) or redlock (needs several Redis).
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
      return this.outdatedOrThrow(location, error);
    }

    // Wave data is a bonus: when it fails the forecast is still worth storing.
    // Locations known to have no wave data skip the call: it would only return nulls
    // (saves a round trip, and probably a quota unit: Open-Meteo applies its limit per IP).
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
    await this.repository.saveRefresh({
      locationId: location.id,
      days,
      marineAvailable,
      elevation: forecast.elevation ?? location.elevation,
      fetchedAt: now,
      expiresAt,
    });

    return {
      days,
      meta: {
        source: DataSource.OPEN_METEO,
        fetchedAt: now,
        nextRefreshAt: expiresAt,
        outdated: false,
      },
    };
  }

  private async readFresh(location: Location): Promise<ForecastResult | null> {
    const state = await this.repository.findState(location.id);
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
        outdated: false,
      },
    };
  }

  /** Stored days from today (in the location's time zone) onward. */
  private loadDays(location: Location, now: Date): Promise<DailyWeatherData[]> {
    return this.repository.findDays(location.id, localDate(now, location.timezone), FORECAST_DAYS);
  }

  /** Another request is refreshing this location: wait for its result instead of calling out. */
  private async waitForOtherRefresh(location: Location): Promise<ForecastResult> {
    // Check every LOCK_POLL_MS (0.5 s by default): fewer database reads, and an Open-Meteo call
    // usually takes a few hundred milliseconds anyway.
    const { lockWaitMs, lockPollMs } = this.config;
    const attempts = Math.ceil(lockWaitMs / lockPollMs);
    for (let attempt = 0; attempt < attempts; attempt++) {
      await sleep(lockPollMs);
      const fresh = await this.readFresh(location);
      if (fresh) return fresh;
    }
    return this.outdatedOrThrow(location, new OpenMeteoUnavailableError('Refresh in progress'));
  }

  private async outdatedOrThrow(location: Location, error: UpstreamError): Promise<ForecastResult> {
    const now = this.clock.now();
    const days = await this.loadDays(location, now);
    if (days.length === 0) throw error;

    const state = await this.repository.findState(location.id);
    const pausedFor = await this.gate.remainingSeconds();
    const retryInSeconds = pausedFor ?? error.retryAfterSeconds;
    return {
      days,
      meta: {
        source: DataSource.DATABASE,
        fetchedAt: state?.fetchedAt ?? now,
        nextRefreshAt: new Date(now.getTime() + retryInSeconds * 1000),
        outdated: true,
      },
    };
  }

  private recordError(location: Location, error: UpstreamError): Promise<void> {
    return this.repository.recordError(location.id, error.message, this.clock.now());
  }
}
