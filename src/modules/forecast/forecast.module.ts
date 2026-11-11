import { Module } from '@nestjs/common';
import { OpenMeteoModule } from '../../infrastructure/open-meteo/open-meteo.module';
import { ForecastRepository } from './forecast.repository';
import { ForecastService } from './forecast.service';

@Module({
  imports: [OpenMeteoModule],
  providers: [ForecastService, ForecastRepository],
  exports: [ForecastService],
})
export class ForecastModule {}
