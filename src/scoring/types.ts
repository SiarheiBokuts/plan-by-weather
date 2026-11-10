import { DailyWeatherData } from '../weather/daily-weather';

// Member names equal the values on purpose: GraphQL exposes enum member NAMES, and the API
// promises SKIING, not Skiing.
export enum Activity {
  SKIING = 'SKIING',
  SURFING = 'SURFING',
  OUTDOOR_SIGHTSEEING = 'OUTDOOR_SIGHTSEEING',
  INDOOR_SIGHTSEEING = 'INDOOR_SIGHTSEEING',
}

/** Fixed order, also used to break ties. */
export const ACTIVITIES: readonly Activity[] = [
  Activity.SKIING,
  Activity.SURFING,
  Activity.OUTDOOR_SIGHTSEEING,
  Activity.INDOOR_SIGHTSEEING,
];

export enum Rating {
  POOR = 'POOR',
  FAIR = 'FAIR',
  GOOD = 'GOOD',
  GREAT = 'GREAT',
}

/** One factor that moved a score, in plain words. */
export interface Reason {
  text: string;
  impact: 'positive' | 'negative' | 'neutral';
  /** Relative strength; the strongest reason becomes the headline of the summary */
  weight: number;
}

export type ScorerOutput =
  { available: true; score: number; reasons: Reason[] } | { available: false; reason: string };

/** Pure: weather for one day in, score out. No I/O. */
export interface ActivityScorer {
  readonly activity: Activity;
  score(day: DailyWeatherData): ScorerOutput;
}
