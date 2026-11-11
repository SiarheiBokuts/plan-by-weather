import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RankingModule } from '../modules/ranking/ranking.module';
import { ClientThrottleGuard } from './graphql/client-throttle.guard';
import { GraphQLErrorFilter } from './graphql/graphql-error.filter';
import { graphqlOptions } from './graphql/graphql.config';
import { RankingResolver } from './graphql/ranking.resolver';
import { HealthController } from './health/health.controller';

/**
 * THE API LAYER: how the outside world talks to this service, and nothing else.
 *   graphql/  the GraphQL API (settings, operations, answer shapes, rate limit, error log, Sandbox examples)
 *   health/   the one REST route, GET /health
 * It calls the services in src/modules; nothing in src/modules knows about GraphQL or HTTP.
 */
@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => graphqlOptions(config),
    }),
    RankingModule,
  ],
  controllers: [HealthController],
  providers: [
    RankingResolver,
    ClientThrottleGuard,
    { provide: APP_FILTER, useClass: GraphQLErrorFilter },
  ],
})
export class ApiModule {}
