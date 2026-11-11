import { Global, Module } from '@nestjs/common';
import { ForecastRepository } from './forecast.repository';
import { LocationsRepository } from './locations.repository';
import { PrismaService } from './prisma.service';

/**
 * ALL DATABASE CODE IS IN THIS FOLDER: the connection (PrismaService) and the repositories, which are
 * the only code that reads and writes the tables (the tables themselves are in prisma/schema.prisma).
 * Services in src/modules get the repositories injected and never touch the database directly.
 */
@Global()
@Module({
  providers: [PrismaService, LocationsRepository, ForecastRepository],
  exports: [PrismaService, LocationsRepository, ForecastRepository],
})
export class DatabaseModule {}
