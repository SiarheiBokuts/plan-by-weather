import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { join } from 'path';
import { CommonModule } from './common/common.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { HealthController } from './modules/health/health.controller';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RankingModule } from './modules/ranking/ranking.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { SANDBOX_DOCUMENT, SANDBOX_VARIABLES } from './sandbox-sample';

/**
 * Apollo Sandbox (the page at /graphql) and schema introspection, switched by GRAPHQL_SANDBOX.
 * An explicit switch instead of Apollo's NODE_ENV default, because Docker runs in production mode
 * and a reviewer still needs the page. Off by default: with it off there is no page and strangers
 * cannot browse the schema (queries from programs still work).
 */
function sandboxSettings(enabled: boolean): Pick<ApolloDriverConfig, 'introspection' | 'plugins'> {
  if (!enabled) {
    return { introspection: false, plugins: [ApolloServerPluginLandingPageDisabled()] };
  }
  return {
    introspection: true,
    plugins: [
      // (Despite "LocalDefault" in its name this works in any environment.)
      ApolloServerPluginLandingPageLocalDefault({
        embed: true, // full Sandbox inside the page (its assets come from Apollo's CDN)
        document: SANDBOX_DOCUMENT, // a ready-made query per operation, see sandbox-sample.ts
        variables: SANDBOX_VARIABLES,
        includeCookies: false, // no cookies or login in this service
      }),
    ],
  };
}

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    RedisModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ApolloDriverConfig => ({
        // Code-first: the GraphQL schema is not written by hand. Nest builds it from the decorated
        // classes (@ObjectType, @Field in modules/ranking/ranking.types.ts, @Query in
        // ranking.resolver.ts) and writes it to schema.gql in the project root on every start.
        // The file is committed only so the API can be read without running the service.
        // (Tests keep the schema in memory instead of writing the file.)
        autoSchemaFile: process.env.NODE_ENV === 'test' ? true : join(process.cwd(), 'schema.gql'),
        sortSchema: true,
        // Off: the old Playground page. Apollo Sandbox (see sandboxSettings) replaces it.
        playground: false,
        // GraphQL does not hand the HTTP request to guards by itself, so put it into the context:
        // it travels on to the rate-limit guard, which reads the client's IP and x-api-key from it.
        context: ({ req }: { req: unknown }) => ({ req }),
        ...sandboxSettings(config.sandboxEnabled),
      }),
    }),
    RankingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
