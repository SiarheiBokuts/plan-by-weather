import { GraphQLError } from 'graphql';

/** Stable machine-readable error codes returned in `extensions.code`. */
export enum ErrorCode {
  LocationNotFound = 'LOCATION_NOT_FOUND',
  InvalidInput = 'BAD_USER_INPUT',
  ClientRateLimited = 'CLIENT_RATE_LIMITED',
  OpenMeteoRateLimited = 'OPEN_METEO_RATE_LIMITED',
  OpenMeteoUnavailable = 'OPEN_METEO_UNAVAILABLE',
}

/** "about 15 minutes", "about 1 hour", "less than a minute" - rounded, for user-facing messages. */
export function humanWait(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export class LocationNotFoundError extends GraphQLError {
  constructor(query: string) {
    super(`We couldn't find a city or town called "${query}".`, {
      extensions: { code: ErrorCode.LocationNotFound },
    });
  }
}

export class InvalidInputError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: ErrorCode.InvalidInput } });
  }
}

export class ClientRateLimitedError extends GraphQLError {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many requests. Please try again in ${humanWait(retryAfterSeconds)}.`, {
      extensions: { code: ErrorCode.ClientRateLimited, retryAfterSeconds },
    });
  }
}

/** Open-Meteo told us to slow down (or we are still paused after it did). */
export class OpenMeteoRateLimitedError extends GraphQLError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      `We can't load weather for this city right now. Please try again in ${humanWait(retryAfterSeconds)}.`,
      { extensions: { code: ErrorCode.OpenMeteoRateLimited, retryAfterSeconds } },
    );
  }
}

export class OpenMeteoUnavailableError extends GraphQLError {
  constructor(
    detail?: string,
    public readonly retryAfterSeconds = 60,
  ) {
    super('The weather service is not reachable right now. Please try again in a few minutes.', {
      extensions: { code: ErrorCode.OpenMeteoUnavailable, retryAfterSeconds, detail },
    });
  }
}
