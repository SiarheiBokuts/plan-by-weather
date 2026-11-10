/** Injection token for the validated application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  /** Empty string disables Redis and uses the in-memory fallback (unit tests). */
  redisUrl: string;
  forecastTtlHours: number;
  clientRateLimit: number;
  clientRateWindowSeconds: number;
  upstreamPauseMinutes: number;
  maxStoredLocations: number;
  /** TTL of the per-location refresh lock. */
  lockTtlMs: number;
  /** How long a request waits for another request's refresh before falling back. */
  lockWaitMs: number;
  openMeteo: {
    geocodingUrl: string;
    forecastUrl: string;
    marineUrl: string;
    timeoutMs: number;
  };
}

type Env = Record<string, string | undefined>;

function positiveNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid configuration: ${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

function text(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Reads and validates configuration from environment variables. Fails fast on bad values. */
export function loadConfig(env: Env = process.env): AppConfig {
  return {
    port: positiveNumber(env, 'PORT', 3000),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379/0',
    forecastTtlHours: positiveNumber(env, 'FORECAST_TTL_HOURS', 6),
    clientRateLimit: positiveNumber(env, 'CLIENT_RATE_LIMIT', 60),
    clientRateWindowSeconds: positiveNumber(env, 'CLIENT_RATE_WINDOW_SECONDS', 60),
    upstreamPauseMinutes: positiveNumber(env, 'UPSTREAM_PAUSE_MINUTES', 15),
    maxStoredLocations: positiveNumber(env, 'MAX_STORED_LOCATIONS', 1000),
    lockTtlMs: positiveNumber(env, 'LOCK_TTL_MS', 30_000),
    lockWaitMs: positiveNumber(env, 'LOCK_WAIT_MS', 10_000),
    openMeteo: {
      geocodingUrl: text(
        env,
        'OPEN_METEO_GEOCODING_URL',
        'https://geocoding-api.open-meteo.com/v1/search',
      ),
      forecastUrl: text(env, 'OPEN_METEO_FORECAST_URL', 'https://api.open-meteo.com/v1/forecast'),
      marineUrl: text(env, 'OPEN_METEO_MARINE_URL', 'https://marine-api.open-meteo.com/v1/marine'),
      timeoutMs: positiveNumber(env, 'OPEN_METEO_TIMEOUT_MS', 8_000),
    },
  };
}
