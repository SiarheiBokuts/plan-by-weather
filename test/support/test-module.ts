import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { Clock } from '../../src/common/clock';
import { CommonModule } from '../../src/common/common.module';
import { APP_CONFIG, AppConfig } from '../../src/config/app-config';
import { ForecastModule } from '../../src/forecast/forecast.module';
import { LocationsModule } from '../../src/locations/locations.module';
import { FETCH_FN } from '../../src/open-meteo/open-meteo.client';
import { OpenMeteoModule } from '../../src/open-meteo/open-meteo.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RankingModule } from '../../src/ranking/ranking.module';
import { REDIS_CLIENT } from '../../src/redis/redis.service';
import { RedisModule } from '../../src/redis/redis.module';
import { ScoringModule } from '../../src/scoring/scoring.module';
import { testConfig } from './builders';
import { FakeClock } from './fake-clock';
import { createFakeOpenMeteo, FakeOpenMeteo } from './fake-open-meteo';

export interface TestContext {
  module: TestingModule;
  clock: FakeClock;
  fake: FakeOpenMeteo;
  config: AppConfig;
  prisma: PrismaService;
  redis: Redis;
  /** Empties the database tables and the Redis database, and resets the fake Open-Meteo */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The real services wired to real Postgres and Redis, with only the outside world replaced:
 * Open-Meteo (recorded responses) and the clock.
 */
export async function createTestContext(
  configOverrides: Partial<AppConfig> = {},
): Promise<TestContext> {
  const clock = new FakeClock();
  const fake = createFakeOpenMeteo();
  const config = testConfig(configOverrides);

  const module = await Test.createTestingModule({
    imports: [
      CommonModule,
      PrismaModule,
      RedisModule,
      OpenMeteoModule,
      LocationsModule,
      ForecastModule,
      ScoringModule,
      RankingModule,
    ],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(FETCH_FN)
    .useValue(fake.fetch)
    .compile();
  await module.init();

  const prisma = module.get(PrismaService);
  const redis = module.get<Redis>(REDIS_CLIENT);

  const reset = async (): Promise<void> => {
    await prisma.$transaction([
      prisma.locationAlias.deleteMany(),
      prisma.dailyWeather.deleteMany(),
      prisma.fetchState.deleteMany(),
      prisma.location.deleteMany(),
    ]);
    await redis.flushdb();
    fake.reset();
    clock.set('2026-11-10T10:00:00Z');
  };

  return { module, clock, fake, config, prisma, redis, reset, close: () => module.close() };
}
