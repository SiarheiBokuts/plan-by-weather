import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { join } from 'path';
import { CommonModule } from './common/common.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RankingModule } from './ranking/ranking.module';
import { RedisModule } from './redis/redis.module';

const SAMPLE_QUERY = `query Ranking($city: String!) {
  activityRanking(city: $city) {
    location { name country region timezone }
    meta { source fetchedAt nextRefreshAt stale }
    byActivity {
      activity
      score
      rating
      bestDay
      available
      unavailableReason
    }
    byDay {
      date
      bestActivity
      weather { condition tempMaxC precipitationMm snowDepthCm }
      activities { activity score rating summary }
    }
  }
}`;

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    RedisModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // The generated schema is committed (schema.gql); tests keep it in memory.
      autoSchemaFile: process.env.NODE_ENV === 'test' ? true : join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      introspection: true,
      playground: false,
      context: ({ req }: { req: unknown }) => ({ req }),
      plugins: [
        // Apollo hides Sandbox when NODE_ENV=production, so it is enabled explicitly: it is the
        // primary way to explore this service.
        ApolloServerPluginLandingPageLocalDefault({
          embed: true,
          document: SAMPLE_QUERY,
          variables: { city: 'Innsbruck' },
          includeCookies: false,
        }),
      ],
    }),
    RankingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
