import { loadConfig } from './app-config';

describe('loadConfig', () => {
  it('uses sensible defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3000,
      publicPort: 3000,
      redisUrl: 'redis://localhost:6379/0',
      forecastTtlHours: 6,
      clientRateLimit: 60,
      clientRateWindowSeconds: 60,
      upstreamPauseMinutes: 15,
      sandboxEnabled: false,
      uiEnabled: false,
      lockPollMs: 500,
      lockWaitMs: 10_000,
    });
    expect(config.openMeteo.geocodingUrl).toContain('geocoding-api.open-meteo.com');
    expect(config.openMeteo.forecastUrl).toContain('api.open-meteo.com');
    expect(config.openMeteo.marineUrl).toContain('marine-api.open-meteo.com');
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      REDIS_URL: 'redis://cache:6379/2',
      FORECAST_TTL_HOURS: '3',
      CLIENT_RATE_LIMIT: '5',
      OPEN_METEO_FORECAST_URL: 'http://localhost:9999/forecast',
    });
    expect(config.port).toBe(8080);
    expect(config.redisUrl).toBe('redis://cache:6379/2');
    expect(config.forecastTtlHours).toBe(3);
    expect(config.clientRateLimit).toBe(5);
    expect(config.openMeteo.forecastUrl).toBe('http://localhost:9999/forecast');
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('reads GRAPHQL_SANDBOX="%s" as %s', (value, expected) => {
    expect(loadConfig({ GRAPHQL_SANDBOX: value }).sandboxEnabled).toBe(expected);
  });

  it('rejects an unclear GRAPHQL_SANDBOX value instead of guessing', () => {
    expect(() => loadConfig({ GRAPHQL_SANDBOX: 'maybe' })).toThrow(/must be true or false/);
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ PORT: '', OPEN_METEO_MARINE_URL: '' }).port).toBe(3000);
  });

  it('allows an empty REDIS_URL, which disables Redis', () => {
    expect(loadConfig({ REDIS_URL: '' }).redisUrl).toBe('');
  });

  it.each(['abc', '0', '-5', 'NaN'])('fails fast on an invalid number "%s"', (value) => {
    expect(() => loadConfig({ FORECAST_TTL_HOURS: value })).toThrow(
      /FORECAST_TTL_HOURS must be a positive number/,
    );
  });
});
