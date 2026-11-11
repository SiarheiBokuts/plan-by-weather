import {
  Field,
  Float,
  GraphQLISODateTime,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { Activity, Rating } from '../scoring/types';
import { DataSource } from '../../domain/data-source';

registerEnumType(Activity, {
  name: 'Activity',
  description: 'Something you might want to do. Each one is scored separately for every day.',
});
registerEnumType(Rating, {
  name: 'Rating',
  description: 'Score bands: POOR 0-39, FAIR 40-59, GOOD 60-79, GREAT 80-100.',
});
registerEnumType(DataSource, {
  name: 'DataSource',
  description: 'Where the weather in a response came from.',
  valuesMap: {
    OPEN_METEO: { description: 'Open-Meteo was called while serving this request.' },
    DATABASE: { description: 'Served from our own database; no Open-Meteo call was made.' },
  },
});

@ObjectType('Location', { description: 'A city or town.' })
export class LocationType {
  @Field() name: string;
  @Field(() => String, { nullable: true }) country: string | null;
  @Field(() => String, { nullable: true, description: 'ISO 3166-1 alpha-2, e.g. "AT".' })
  countryCode: string | null;
  @Field(() => String, { nullable: true, description: 'State, province or region.' })
  region: string | null;
  @Field(() => Float) latitude: number;
  @Field(() => Float) longitude: number;
  @Field(() => Float, { nullable: true, description: 'Metres above sea level.' })
  elevationM: number | null;
  @Field({ description: 'IANA time zone; all dates in the response are local to it.' })
  timezone: string;
}

@ObjectType('DayWeather', { description: 'The weather of one day that the scores are based on.' })
export class DayWeatherType {
  @Field({ description: 'Local date, YYYY-MM-DD.' }) date: string;
  @Field({ description: 'Short plain-English condition, e.g. "Rain showers".' }) condition: string;
  @Field(() => Float, { nullable: true }) tempMaxC: number | null;
  @Field(() => Float, { nullable: true }) tempMinC: number | null;
  @Field(() => Float, { nullable: true }) precipitationMm: number | null;
  @Field(() => Float, { nullable: true }) snowfallCm: number | null;
  @Field(() => Float, { nullable: true, description: 'Deepest snow on the ground that day.' })
  snowDepthCm: number | null;
  @Field(() => Float, { nullable: true }) windMaxKmh: number | null;
  @Field(() => Float, { nullable: true, description: 'Null when there is no wave data.' })
  waveHeightMaxM: number | null;
}

@ObjectType('ScoreFactor', {
  description:
    'One line of the explanation of a score: a condition, what was measured, and the points it earned.',
})
export class ScoreFactorType {
  @Field({ description: 'The condition, e.g. "Rain" or "Wave height".' }) label: string;
  @Field(() => String, {
    nullable: true,
    description: 'What was measured, e.g. "0.8 mm". Null when the data is missing.',
  })
  value: string | null;
  @Field(() => Float, {
    nullable: true,
    description:
      'Mark from 0 (very bad) to 100 (ideal) for this value. Null for lines that are not measured conditions.',
  })
  mark: number | null;
  @Field(() => Float, {
    nullable: true,
    description: "This condition's share of the 100 points, in percent.",
  })
  weight: number | null;
  @Field(() => Float, {
    description: 'Points earned: the mark times the weight (negative for a deduction).',
  })
  points: number;
  @Field(() => Float, {
    nullable: true,
    description: 'The highest total score this condition allows, when it sets a ceiling.',
  })
  limit: number | null;
}

@ObjectType('ScoreBreakdown', {
  description:
    'Everything behind one score: the conditions, the points they add up to, and what limited the result.',
})
export class ScoreBreakdownType {
  @Field(() => [ScoreFactorType]) factors: ScoreFactorType[];
  @Field(() => Float, { description: 'The points added up, before any ceiling.' }) points: number;
  @Field(() => String, {
    nullable: true,
    description: 'What lowered the score below the points (the lowest ceiling), or null.',
  })
  limitedBy: string | null;
}

@ObjectType('ActivityDayScore', { description: 'How suitable one activity is on one day.' })
export class ActivityDayScoreType {
  @Field(() => Activity) activity: Activity;
  @Field({ description: 'Local date, YYYY-MM-DD.' }) date: string;
  @Field({ description: 'False when the data this activity needs does not exist here.' })
  available: boolean;
  @Field(() => Int, { nullable: true, description: '0-100; null when unavailable.' })
  score: number | null;
  @Field(() => Rating, { nullable: true }) rating: Rating | null;
  @Field({
    description: 'One plain sentence, e.g. "Rain (12.0 mm): not a day for walking around."',
  })
  summary: string;
  @Field(() => [String], { description: 'The factors behind the score.' }) reasons: string[];
  @Field(() => ScoreBreakdownType, {
    nullable: true,
    description: 'The full explanation: each condition with its value, mark, weight and points.',
  })
  breakdown: ScoreBreakdownType | null;
  @Field(() => String, { nullable: true }) unavailableReason: string | null;
}

@ObjectType('RankedActivityDay', {
  description: 'A day of one activity, with its place in the week.',
})
export class RankedActivityDayType extends ActivityDayScoreType {
  @Field(() => Int, {
    nullable: true,
    description: '1 is the best day of the week for this activity.',
  })
  rank: number | null;
}

@ObjectType('ActivityOutlook', { description: 'The 7-day outlook of one activity.' })
export class ActivityOutlookType {
  @Field(() => Activity) activity: Activity;
  @Field() available: boolean;
  @Field(() => String, { nullable: true }) unavailableReason: string | null;
  @Field(() => Int, { nullable: true, description: 'Average of the available days.' })
  score: number | null;
  @Field(() => Rating, { nullable: true }) rating: Rating | null;
  @Field(() => String, { nullable: true, description: 'Date of the highest-scoring day.' })
  bestDay: string | null;
  @Field(() => [RankedActivityDayType]) days: RankedActivityDayType[];
}

@ObjectType('DayOutlook', { description: 'One day with all activities scored.' })
export class DayOutlookType {
  @Field() date: string;
  @Field(() => DayWeatherType) weather: DayWeatherType;
  @Field(() => [ActivityDayScoreType], { description: 'Best first; unavailable ones last.' })
  activities: ActivityDayScoreType[];
  @Field(() => Activity, { nullable: true, description: 'The highest-scoring activity today.' })
  bestActivity: Activity | null;
}

@ObjectType('ResponseMeta', { description: 'Where the data came from and how fresh it is.' })
export class ResponseMetaType {
  @Field(() => DataSource) source: DataSource;
  @Field(() => GraphQLISODateTime, { description: 'When the weather was last fetched.' })
  fetchedAt: Date;
  @Field(() => GraphQLISODateTime, { description: 'Earliest time a refresh can happen.' })
  nextRefreshAt: Date;
  @Field({ description: 'True when stored data is shown because a refresh was not possible.' })
  outdated: boolean;
}

@ObjectType('ActivityRanking')
export class ActivityRankingType {
  @Field(() => LocationType, { description: 'The place that was chosen for the name you gave.' })
  location: LocationType;
  @Field(() => [ActivityOutlookType], { description: 'Activities, best week first.' })
  byActivity: ActivityOutlookType[];
  @Field(() => [DayOutlookType], { description: 'The next 7 days, each with all activities.' })
  byDay: DayOutlookType[];
  @Field(() => ResponseMetaType) meta: ResponseMetaType;
}
