import { Module } from '@nestjs/common';
import { OpenMeteoModule } from '../../infrastructure/open-meteo/open-meteo.module';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

@Module({
  imports: [OpenMeteoModule],
  providers: [LocationsService, LocationsRepository],
  exports: [LocationsService],
})
export class LocationsModule {}
