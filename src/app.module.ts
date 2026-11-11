import { Module } from '@nestjs/common';
import { ApiModule } from './api/api.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';

@Module({
  imports: [CommonModule, DatabaseModule, RedisModule, ApiModule],
})
export class AppModule {}
