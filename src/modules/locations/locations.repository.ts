import { Injectable } from '@nestjs/common';
import { Location, Prisma } from '@prisma/client';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * STORAGE of cities. The only place that knows how locations and their aliases are saved.
 * It decides nothing about the business: when to refresh or which match to choose is the
 * service's job; this class just reads and writes. Every resolved city is kept.
 */
@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The place a typed name already points to, or null if we have not seen that name. */
  async findByAlias(aliasKey: string): Promise<Location | null> {
    const alias = await this.prisma.locationAlias.findUnique({
      where: { query: aliasKey },
      include: { location: true },
    });
    return alias?.location ?? null;
  }

  /**
   * Notes that a place was requested at `at`. Nothing reads this yet; it is recorded so that a
   * future cleanup of cities nobody asks about any more has the data it needs.
   */
  touch(id: number, at: Date): Promise<Location> {
    return this.prisma.location.update({ where: { id }, data: { lastRequestedAt: at } });
  }

  /**
   * Saves a geocoded place and the name that led to it, in one transaction.
   * Two requests for a brand-new city can race on the unique key; the loser simply retries once.
   */
  async saveResolved(match: GeocodeResult, aliasKey: string, now: Date): Promise<Location> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const location = await tx.location.upsert({
            where: { externalId: match.id },
            create: {
              externalId: match.id,
              name: match.name,
              country: match.country,
              countryCode: match.countryCode,
              region: match.region,
              latitude: match.latitude,
              longitude: match.longitude,
              elevation: match.elevation,
              timezone: match.timezone,
              lastRequestedAt: now,
            },
            update: { lastRequestedAt: now },
          });
          await tx.locationAlias.upsert({
            where: { query: aliasKey },
            create: { query: aliasKey, locationId: location.id },
            update: { locationId: location.id },
          });
          return location;
        });
      } catch (error) {
        const uniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!uniqueViolation || attempt >= 1) throw error;
      }
    }
  }
}
