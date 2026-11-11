/** Injection token for the validated application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  /** The port you open in the browser. Differs from `port` in Docker (3000 inside, APP_PORT outside); only used in the start-up log. */
  publicPort: number;
  /** Empty string disables Redis and uses the in-memory fallback (unit tests). */
  redisUrl: string;
  forecastTtlHours: number;
  clientRateLimit: number;
  clientRateWindowSeconds: number;
  upstreamPauseMinutes: number;
  /** Apollo Sandbox page and GraphQL introspection. Off unless asked for (see GRAPHQL_SANDBOX). */
  sandboxEnabled: boolean;
  /** The optional test web page at /ui (see public/). Off unless asked for (UI_ENABLED). */
  uiEnabled: boolean;
  /** TTL of the per-location refresh lock. */
  lockTtlMs: number;
  /** How long a request waits for another request's refresh before falling back. */
  lockWaitMs: number;
  /** How often a waiting request checks whether the other request has finished. */
  lockPollMs: number;
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

function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Invalid configuration: ${name} must be true or false, got "${env[name]}"`);
}

function text(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Reads and validates configuration from environment variables. Fails fast on bad values.
 * By hand because it is a flat list of numbers, flags and URLs; @nestjs/config with a schema would
 * add two dependencies for the same result.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const port = positiveNumber(env, 'PORT', 3000);
  return {
    port,
    publicPort: positiveNumber(env, 'PUBLIC_PORT', port),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379/0',
    forecastTtlHours: positiveNumber(env, 'FORECAST_TTL_HOURS', 6),
    clientRateLimit: positiveNumber(env, 'CLIENT_RATE_LIMIT', 60),
    clientRateWindowSeconds: positiveNumber(env, 'CLIENT_RATE_WINDOW_SECONDS', 60),
    upstreamPauseMinutes: positiveNumber(env, 'UPSTREAM_PAUSE_MINUTES', 15),
    sandboxEnabled: flag(env, 'GRAPHQL_SANDBOX', false),
    uiEnabled: flag(env, 'UI_ENABLED', false),
    lockTtlMs: positiveNumber(env, 'LOCK_TTL_MS', 30_000),
    lockWaitMs: positiveNumber(env, 'LOCK_WAIT_MS', 10_000),
    lockPollMs: positiveNumber(env, 'LOCK_POLL_MS', 500),
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
