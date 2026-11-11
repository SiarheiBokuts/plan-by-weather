import { Injectable } from '@nestjs/common';
import { FetchState } from '@prisma/client';
import { DailyWeatherData } from '../../domain/daily-weather';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface SaveRefresh {
  locationId: number;
  days: DailyWeatherData[];
  /** null = not checked, false = no wave data here, true = has wave data */
  marineAvailable: boolean | null;
  elevation: number | null;
  fetchedAt: Date;
  expiresAt: Date;
}

/** The database column is a plain DATE; Prisma hands it over as UTC midnight, so UTC is the safe way to convert. */
const toDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

/**
 * STORAGE of weather. The only place that knows how forecast days and refresh records are saved.
 * It decides nothing about the business; the service decides when to read, refresh or give up.
 */
@Injectable()
export class ForecastRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** When the place was last refreshed and when it may be refreshed again. */
  findState(locationId: number): Promise<FetchState | null> {
    return this.prisma.fetchState.findUnique({ where: { locationId } });
  }

  /** Up to `limit` stored days, from local date `fromDate` onward, oldest first. */
  async findDays(locationId: number, fromDate: string, limit: number): Promise<DailyWeatherData[]> {
    const rows = await this.prisma.dailyWeather.findMany({
      where: { locationId, date: { gte: toDate(fromDate) } },
      orderBy: { date: 'asc' },
      take: limit,
    });
    return rows.map(({ locationId: _locationId, date, ...day }) => ({
      ...day,
      date: date.toISOString().slice(0, 10),
    }));
  }

  /**
   * Replaces a place's stored days with a fresh forecast and records when it may be refreshed
   * again, in one transaction. Replacing (not adding) means past days disappear and a day can
   * never appear twice.
   */
  async saveRefresh(refresh: SaveRefresh): Promise<void> {
    const { locationId, days, marineAvailable, elevation, fetchedAt, expiresAt } = refresh;
    await this.prisma.$transaction([
      this.prisma.dailyWeather.deleteMany({ where: { locationId } }),
      this.prisma.dailyWeather.createMany({
        data: days.map((day) => ({ ...day, date: toDate(day.date), locationId })),
      }),
      this.prisma.fetchState.upsert({
        where: { locationId },
        create: { locationId, fetchedAt, expiresAt },
        update: { fetchedAt, expiresAt, lastError: null, lastErrorAt: null },
      }),
      this.prisma.location.update({
        where: { id: locationId },
        data: { marineAvailable, elevation },
      }),
    ]);
  }

  /** Notes a failed refresh on the existing record (nothing to note for a never-fetched place). */
  async recordError(locationId: number, message: string, at: Date): Promise<void> {
    await this.prisma.fetchState.updateMany({
      where: { locationId },
      data: { lastError: message, lastErrorAt: at },
    });
  }
}
