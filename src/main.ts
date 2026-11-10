import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  // Graceful shutdown. `docker stop` (and Ctrl+C) send SIGTERM/SIGINT; with this on, Nest finishes
  // in-flight requests and runs the onModuleDestroy hooks, which close the Postgres pool and the
  // Redis connection cleanly. Without it the process is killed mid-request after Docker's timeout.
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `GraphQL (Apollo Sandbox) at http://localhost:${config.port}/graphql`,
  );
}

void bootstrap();
