import { Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import {
  ClientRateLimitedError,
  LocationNotFoundError,
  OpenMeteoUnavailableError,
} from '../../common/errors';
import { GraphQLErrorFilter } from './graphql-error.filter';

describe('GraphQLErrorFilter', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const filter = new GraphQLErrorFilter();

  beforeEach(() => warn.mockClear());

  it('logs a typed error as one short line and hands the same error back', () => {
    const error = new LocationNotFoundError('Atlantis');
    expect(filter.catch(error)).toBe(error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`LOCATION_NOT_FOUND: ${error.message}`);
  });

  it('logs Open-Meteo problems too', () => {
    filter.catch(new OpenMeteoUnavailableError('HTTP 503'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('OPEN_METEO_UNAVAILABLE'));
  });

  it('stays quiet about rate-limited clients (the guard logs those once per window)', () => {
    const error = new ClientRateLimitedError(30);
    expect(filter.catch(error)).toBe(error);
    expect(warn).not.toHaveBeenCalled();
  });

  it('copes with an error that has no code', () => {
    expect(() => filter.catch(new GraphQLError('plain'))).not.toThrow();
  });
});
