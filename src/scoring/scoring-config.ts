import { Activity, Rating } from './types';

/**
 * Every threshold and weight of the scoring rules, in one place. Scores start at a base and
 * lose capped penalties for bad conditions; nothing here is meteorological science, it is a
 * set of explainable rules of thumb.
 */
export const SCORING = {
  /** Lowest score of each rating band */
  bands: { fair: 40, good: 60, great: 80 },

  outdoor: {
    idealTempC: { min: 14, max: 26 },
    coldPenaltyPerDegree: 3,
    coldMaxPenalty: 45,
    heatPenaltyPerDegree: 4,
    heatMaxPenalty: 40,
    /** Any noticeable rain costs `basePenalty`; it grows to `maxPenalty` at `heavyMm` */
    rain: { noticeMm: 0.5, lightMm: 2.5, heavyMm: 6, basePenalty: 15, maxPenalty: 65 },
    snow: { noticeCm: 1, heavyCm: 10, maxPenalty: 35 },
    wind: { comfortableKmh: 25, extremeKmh: 60, maxPenalty: 25 },
    thunderstormCap: 20,
    sunnyHours: 6,
  },

  indoor: {
    base: 60,
    /** Share of the "badness" of the outdoor day added as a bonus */
    bonusFactor: 0.4,
    severe: { gustKmh: 70, snowfallCm: 15, penalty: 15 },
  },

  skiing: {
    minDepthCm: 5,
    minFreshCm: 2,
    noSnowScore: 5,
    base: 35,
    fullDepthCm: 60,
    depthMaxPoints: 50,
    fullFreshCm: 15,
    freshMaxPoints: 15,
    warmAboveC: 2,
    warmPenaltyPerDegree: 5,
    warmMaxPenalty: 25,
    veryColdBelowC: -15,
    veryColdPenalty: 10,
    wind: { fromKmh: 35, toKmh: 70, maxPenalty: 20 },
    rainOnSnow: { minMm: 2, freshShareBelow: 0.5, aboveC: 1, penalty: 15 },
  },

  surfing: {
    base: 10,
    /** Wave height (m) -> points (0-70) breakpoints */
    tinyM: 0.3,
    smallM: 1,
    bigM: 2.5,
    hugeM: 4,
    pointsAtSmall: 50,
    pointsAtIdeal: 70,
    pointsAtBig: 40,
    pointsTooBig: 20,
    tinyPoints: 5,
    period: { fromS: 6, toS: 10, maxPoints: 20, longSwellS: 9 },
    wind: { fromKmh: 25, toKmh: 60, maxPenalty: 25 },
    coldBelowC: 8,
    coldPenalty: 10,
    heavyRainMm: 10,
    heavyRainPenalty: 10,
    thunderstormCap: 20,
  },
} as const;

/** What the summary sentence says after the headline factor, by activity and rating. */
export const VERDICTS: Record<Activity, Record<Rating, string>> = {
  [Activity.OUTDOOR_SIGHTSEEING]: {
    [Rating.POOR]: 'not a day for walking around',
    [Rating.FAIR]: 'so-so for being outside',
    [Rating.GOOD]: 'good for exploring outside',
    [Rating.GREAT]: 'great for exploring outside',
  },
  [Activity.INDOOR_SIGHTSEEING]: {
    [Rating.POOR]: 'getting around may be risky, better stay in',
    [Rating.FAIR]: 'indoor plans are possible, but getting around may be hard',
    [Rating.GOOD]: 'a good day for museums and indoor plans',
    [Rating.GREAT]: 'a perfect day for museums and indoor plans',
  },
  [Activity.SKIING]: {
    [Rating.POOR]: 'not a ski day',
    [Rating.FAIR]: 'marginal for skiing',
    [Rating.GOOD]: 'good for skiing',
    [Rating.GREAT]: 'great skiing conditions',
  },
  [Activity.SURFING]: {
    [Rating.POOR]: 'not worth getting wet',
    [Rating.FAIR]: 'marginal for surfing',
    [Rating.GOOD]: 'good for surfing',
    [Rating.GREAT]: 'great surf',
  },
};
