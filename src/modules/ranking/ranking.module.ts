import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { LocationsModule } from '../locations/locations.module';
import { ScoringModule } from '../scoring/scoring.module';
import { RankingService } from './ranking.service';

/** The ranking logic (no GraphQL in here: the API layer in src/api uses RankingService). */
@Module({
  imports: [LocationsModule, ForecastModule, ScoringModule],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
