import { Module } from '@nestjs/common';
import { OpenMeteoModule } from '../open-meteo/open-meteo.module';
import { ForecastService } from './forecast.service';

@Module({
  imports: [OpenMeteoModule],
  providers: [ForecastService],
  exports: [ForecastService],
})
export class ForecastModule {}
