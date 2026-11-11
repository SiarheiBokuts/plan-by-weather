import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  database: 'up' | 'down';
  redis: 'up' | 'down' | 'disabled';
}

// Two checks, so a small controller instead of @nestjs/terminus.
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 200 when the database is up (Redis down only degrades), 503 when the database is down. */
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.databaseStatus(), this.redis.status()]);
    const status = database === 'down' ? 'down' : redis === 'down' ? 'degraded' : 'ok';
    if (status === 'down') response.status(503);
    return { status, database, redis };
  }

  private async databaseStatus(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
