import { Module } from '@nestjs/common';
import { OpenMeteoModule } from '../../infrastructure/open-meteo/open-meteo.module';
import { LocationsService } from './locations.service';

@Module({
  imports: [OpenMeteoModule],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
