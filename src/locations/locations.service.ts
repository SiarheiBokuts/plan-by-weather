import { Inject, Injectable } from '@nestjs/common';
import { Location, Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { InvalidInputError, LocationNotFoundError } from '../common/errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { OpenMeteoClient } from '../open-meteo/open-meteo.client';
import { GeocodeResult } from '../open-meteo/open-meteo.types';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: OpenMeteoClient,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Finds (or geocodes once and stores) the best matching city or town. */
  async resolve(city: string, countryCode?: string | null): Promise<Location> {
    const query = normalizeQuery(city, countryCode);

    const alias = await this.prisma.locationAlias.findUnique({
      where: { query: query.key },
      include: { location: true },
    });
    if (alias) return this.touch(alias.location);

    const [best] = onlySettlements(await this.client.geocode(query.name, query.countryCode));
    if (!best) throw new LocationNotFoundError(query.name);
    return this.store(best, query.key);
  }

  /** Candidate cities for a name, best first. Nothing is stored. */
  async search(city: string, countryCode?: string | null): Promise<GeocodeResult[]> {
    const query = normalizeQuery(city, countryCode);
    const results = await this.client.geocode(query.name, query.countryCode, 10);
    return onlySettlements(results).slice(0, CANDIDATES);
  }

  private async touch(location: Location): Promise<Location> {
    const now = this.clock.now();
    if (now.getTime() - location.lastRequestedAt.getTime() < TOUCH_INTERVAL_MS) return location;
    return this.prisma.location.update({
      where: { id: location.id },
      data: { lastRequestedAt: now },
    });
  }

  private async store(match: GeocodeResult, aliasKey: string): Promise<Location> {
    // Two requests for a brand-new city can race on the unique key; the loser simply retries.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const now = this.clock.now();
          const data = {
            name: match.name,
            country: match.country,
            countryCode: match.countryCode,
            region: match.region,
            latitude: match.latitude,
            longitude: match.longitude,
            elevation: match.elevation,
            timezone: match.timezone,
            lastRequestedAt: now,
          };
          const location = await tx.location.upsert({
            where: { externalId: match.id },
            create: { externalId: match.id, ...data },
            update: { lastRequestedAt: now },
          });
          await tx.locationAlias.upsert({
            where: { query: aliasKey },
            create: { query: aliasKey, locationId: location.id },
            update: { locationId: location.id },
          });
          await this.enforceCap(tx, location.id);
          return location;
        });
      } catch (error) {
        const uniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!uniqueViolation || attempt >= 1) throw error;
      }
    }
  }

  /** Removes the least recently requested locations (with their weather) beyond the cap. */
  private async enforceCap(tx: Prisma.TransactionClient, keepId: number): Promise<void> {
    const total = await tx.location.count();
    const excess = total - this.config.maxStoredLocations;
    if (excess <= 0) return;
    const oldest = await tx.location.findMany({
      where: { id: { not: keepId } },
      orderBy: { lastRequestedAt: 'asc' },
      take: excess,
      select: { id: true },
    });
    await tx.location.deleteMany({ where: { id: { in: oldest.map((row) => row.id) } } });
  }
}
