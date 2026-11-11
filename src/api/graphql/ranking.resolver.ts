import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { ClientThrottleGuard } from './client-throttle.guard';
import { RankingService } from '../../modules/ranking/ranking.service';
import { ActivityRankingType, LocationType } from './ranking.model';

/**
 * THE API LIVES HERE. GraphQL has no URL per operation like REST: there is one endpoint, /graphql, and
 * every method below marked @Query is one operation a client can ask for (activityRanking, searchLocations).
 * The shape of each answer is described by the classes in ranking.model.ts (@ObjectType and @Field).
 * Nest builds the schema from these two files and writes it to schema.gql. No logic here: the resolver
 * only hands the arguments to RankingService.
 */
@Resolver()
@UseGuards(ClientThrottleGuard)
export class RankingResolver {
  constructor(private readonly ranking: RankingService) {}

  @Query(() => ActivityRankingType, {
    description:
      'How good each of the next 7 days is for skiing, surfing, outdoor sightseeing and indoor ' +
      'sightseeing in a city or town. Scores are 0-100 with a one-sentence explanation per day.',
  })
  activityRanking(
    @Args('city', { description: 'City or town name, e.g. "Innsbruck". At least 2 characters.' })
    city: string,
    @Args('countryCode', {
      type: () => String,
      nullable: true,
      description: 'Optional ISO country code to pick the right place, e.g. "US" for Paris, Texas.',
    })
    countryCode?: string,
  ): Promise<ActivityRankingType> {
    return this.ranking.rank(city, countryCode) as Promise<ActivityRankingType>;
  }

  @Query(() => [LocationType], {
    description:
      'Cities and towns matching a name, best match first. Use it to find a countryCode.',
  })
  searchLocations(
    @Args('query', { description: 'At least 2 characters.' }) query: string,
    @Args('countryCode', { type: () => String, nullable: true }) countryCode?: string,
  ): Promise<LocationType[]> {
    return this.ranking.search(query, countryCode);
  }
}
