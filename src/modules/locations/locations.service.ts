import { Injectable } from '@nestjs/common';
import { Location } from '@prisma/client';
import { Clock } from '../../common/clock';
import { InvalidInputError, LocationNotFoundError } from '../../common/errors';
import { OpenMeteoClient } from '../../infrastructure/open-meteo/client/open-meteo.client';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { LocationsRepository } from './locations.repository';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const CANDIDATES = 5;
/** lastRequestedAt is refreshed at most this often, so reads do not write on every request */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface NormalizedQuery {
  /** What we send to the geocoder */
  name: string;
  countryCode?: string;
  /** Stable key for the alias table */
  key: string;
}

export function normalizeQuery(city: string, countryCode?: string | null): NormalizedQuery {
  const name = city.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_QUERY_LENGTH) {
    throw new InvalidInputError(`Please enter at least ${MIN_QUERY_LENGTH} characters.`);
  }
  if (name.length > MAX_QUERY_LENGTH) {
    throw new InvalidInputError(`City names are limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  let code: string | undefined;
  if (countryCode !== undefined && countryCode !== null && countryCode.trim() !== '') {
    if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) {
      throw new InvalidInputError('countryCode must be a 2-letter ISO country code, e.g. "US".');
    }
    code = countryCode.trim().toUpperCase();
  }
  return { name, countryCode: code, key: `${name.toLowerCase()}|${code ?? ''}` };
}

/** Keeps real settlements (GeoNames "PPL*"); drops airports, stations and other features. */
export function onlySettlements(results: GeocodeResult[]): GeocodeResult[] {
  return results.filter((result) => result.featureCode?.startsWith('PPL'));
}

/**
 * BUSINESS LOGIC for finding a city: clean up what the user typed, reuse a place we already know,
 * otherwise geocode once and pick the best real town. Storage is delegated to the repository and
 * the geocoder to the Open-Meteo client.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly repository: LocationsRepository,
    private readonly client: OpenMeteoClient,
    private readonly clock: Clock,
  ) {}

  /** Finds (or geocodes once and stores) the best matching city or town. */
  async resolve(city: string, countryCode?: string | null): Promise<Location> {
    const query = normalizeQuery(city, countryCode);

    const known = await this.repository.findByAlias(query.key);
    if (known) return this.markRequested(known);

    const [best] = onlySettlements(await this.client.geocode(query.name, query.countryCode));
    if (!best) throw new LocationNotFoundError(query.name);
    return this.repository.saveResolved(best, query.key, this.clock.now());
  }

  /** Candidate cities for a name, best first. Nothing is stored. */
  async search(city: string, countryCode?: string | null): Promise<GeocodeResult[]> {
    const query = normalizeQuery(city, countryCode);
    const results = await this.client.geocode(query.name, query.countryCode, 10);
    return onlySettlements(results).slice(0, CANDIDATES);
  }

  /** Writes "requested now" at most once an hour, so reads do not turn into a write each time. */
  private async markRequested(location: Location): Promise<Location> {
    const now = this.clock.now();
    if (now.getTime() - location.lastRequestedAt.getTime() < TOUCH_INTERVAL_MS) return location;
    return this.repository.touch(location.id, now);
  }
}
