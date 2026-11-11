import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, config);
  // On `docker stop` / Ctrl+C, finish in-flight requests and close the Postgres and Redis connections
  // instead of being killed mid-request.
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Listening on port ${config.port} (inside Docker the host port is set in docker-compose.yml). GraphQL at /graphql`,
  );
}

void bootstrap();
