import { NestExpressApplication } from '@nestjs/platform-express';
import type { Application } from 'express';
import { join } from 'path';
import { AppConfig } from './config/app-config';

/**
 * Settings that belong to the running HTTP server rather than to a module. Used by main.ts, and by the
 * tests so that they exercise the same setup.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  if (config.uiEnabled) {
    // The optional test UI (not part of the assignment): one static page in `public/`, which only
    // talks to the public GraphQL API. `public/` sits next to `src/` and, once built, next to `dist/`.
    app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/ui/' });
    // Opening the bare address shows the page instead of an error.
    const server: Application = app.getHttpAdapter().getInstance();
    server.get('/', (_request, response) => response.redirect('/ui/'));
  }
}
