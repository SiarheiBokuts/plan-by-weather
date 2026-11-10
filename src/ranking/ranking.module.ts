import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { LocationsModule } from '../locations/locations.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ClientThrottleGuard } from '../throttling/client-throttle.guard';
import { RankingResolver } from './ranking.resolver';
import { RankingService } from './ranking.service';

@Module({
  imports: [LocationsModule, ForecastModule, ScoringModule],
  providers: [RankingService, RankingResolver, ClientThrottleGuard],
})
export class RankingModule {}
