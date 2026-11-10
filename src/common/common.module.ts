import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/app-config';
import { Clock, SystemClock } from './clock';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [APP_CONFIG, Clock],
})
export class CommonModule {}
