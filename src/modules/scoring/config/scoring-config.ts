import { Curve } from '../engine/model';
import { Activity, Rating } from '../types';

/**
 * EVERY NUMBER BEHIND THE SCORES, in one place. Rules of thumb, not meteorology. The maths is in
 * engine/model.ts (`combine`); in short, for each activity:
 *
 *   1. A CURVE turns a measurement into a mark 0-100: a list of [measurement, mark] points joined by
 *      straight lines. Rain [[0, 100], [1, 62], [5, 28]]: dry = 100, 1 mm = 62, 3 mm = 45 (halfway).
 *   2. The WEIGHTS (five per activity, adding up to 100) say how many points each condition can earn;
 *      the points are added up: 30% x 100 + 35% x 73.5 + ... = 79.5. Missing data is left out.
 *   3. A bad enough condition sets a CEILING (a "limit" curve): rain 12 mm allows at most 18.
 *   4. CAPS are fixed ceilings for dealbreakers (thunderstorm, no snow at all).
 *
 *   score = the points, but never more than the lowest ceiling or cap, rounded.
 *
 * SCORING.md (next to this file) shows every curve as a table. It is generated from this file: after
 * changing a number run `npm run docs:scoring` (a test fails if they disagree).
 * Texts and what each activity measures: ../scorers/*.scorer.ts. Indoor sightseeing is derived from the
 * outdoor result (scorers/indoor.scorer.ts). Typical days are pinned by ../scoring.calibration.spec.ts.
 */
export const SCORING = {
  /** Lowest score of each rating band */
  bands: { fair: 40, good: 60, great: 80 },

  outdoor: {
    weights: { precipitation: 30, temperature: 35, sky: 15, wind: 10, visibility: 10 },
    /** Rain, mm per day */
    rainMm: [
      [0, 100],
      [0.2, 95],
      [0.5, 80],
      [1, 62],
      [2.5, 45],
      [5, 28],
      [10, 8],
      [20, 0],
    ] as Curve,
    /** Ceiling for the whole score from the rain alone: a downpour ruins a walk whatever else is nice */
    rainLimitMm: [
      [0, 100],
      [2.5, 100],
      [5, 40],
      [10, 20],
      [20, 10],
    ] as Curve,
    /** Snowfall, cm per day (replaces the rain curve when it snows) */
    snowCm: [
      [0, 100],
      [1, 65],
      [3, 35],
      [8, 8],
    ] as Curve,
    /** Felt ("apparent") temperature, degrees C: pleasant 18-24, falling off both ways */
    feltTempC: [
      [-10, 0],
      [0, 12],
      [5, 30],
      [10, 62],
      [14, 85],
      [18, 100],
      [24, 100],
      [28, 80],
      [32, 50],
      [36, 20],
      [40, 0],
    ] as Curve,
    /** Ceiling from the temperature alone: a freezing or scorching day is not a good walking day */
    tempLimitC: [
      [-10, 10],
      [0, 50],
      [5, 60],
      [10, 80],
      [14, 100],
      [28, 100],
      [32, 70],
      [36, 48],
      [40, 25],
    ] as Curve,
    /** Average cloud cover, percent: a grey sky is a worse sightseeing day than a bright one */
    cloudPct: [
      [0, 100],
      [25, 95],
      [50, 78],
      [75, 52],
      [100, 25],
    ] as Curve,
    /** Used instead of cloud cover when only hours of sunshine are known */
    sunshineHours: [
      [0, 35],
      [2, 58],
      [5, 85],
      [8, 100],
    ] as Curve,
    windKmh: [
      [15, 100],
      [25, 90],
      [35, 70],
      [50, 38],
      [70, 10],
      [90, 0],
    ] as Curve,
    /** Ceiling from the wind alone */
    windLimitKmh: [
      [0, 100],
      [30, 100],
      [45, 70],
      [60, 50],
      [80, 30],
    ] as Curve,
    /** Fog: you can walk, but you will not see the sights */
    fogScore: 20,
    fogLimit: 50,
    caps: {
      thunderstorm: 20,
      /** Gusts from this speed cap the score at gustMax */
      gustKmh: 80,
      gustMax: 40,
    },
  },

  indoor: {
    /** Indoor sights are always an option, so a calm good day still scores this */
    base: 60,
    /** Share of how bad the outdoor day is that is added on top (bad weather = better museum day) */
    bonusFactor: 0.4,
    severe: { gustKmh: 70, snowfallCm: 15, penalty: 15 },
  },

  skiing: {
    weights: { snowDepth: 40, freshSnow: 10, temperature: 25, wind: 15, visibility: 10 },
    /** Snow on the ground, cm */
    snowDepthCm: [
      [0, 0],
      [5, 10],
      [15, 40],
      [30, 65],
      [60, 92],
      [100, 100],
    ] as Curve,
    /** A thin base limits the day however good the rest is */
    depthLimitCm: [
      [0, 5],
      [5, 40],
      [15, 60],
      [30, 85],
      [60, 100],
    ] as Curve,
    /** New snow today, cm: nice to have, not required */
    freshSnowCm: [
      [0, 65],
      [3, 80],
      [10, 100],
    ] as Curve,
    /** Warmest temperature of the day, degrees C: cold and dry keeps snow good, warmth ruins it */
    tempMaxC: [
      [-25, 40],
      [-15, 75],
      [-8, 100],
      [-2, 100],
      [0, 85],
      [2, 55],
      [5, 25],
      [10, 5],
    ] as Curve,
    /** Soft, wet snow limits the day */
    tempLimitC: [
      [1, 100],
      [3, 70],
      [6, 45],
      [10, 25],
    ] as Curve,
    windKmh: [
      [15, 100],
      [30, 85],
      [45, 50],
      [60, 20],
      [80, 0],
    ] as Curve,
    /** Lifts close and the slopes are miserable in strong wind */
    windLimitKmh: [
      [0, 100],
      [35, 100],
      [50, 70],
      [65, 45],
      [80, 25],
    ] as Curve,
    fogScore: 25,
    caps: {
      /** Less than this much snow on the ground and less than minFreshCm new snow: no skiing */
      minDepthCm: 5,
      minFreshCm: 2,
      noSnow: 5,
      /** Rain on snow: at least this much precipitation, mostly rain, above this temperature */
      rainOnSnow: { minMm: 2, freshShareBelow: 0.5, aboveC: 1, max: 45 },
    },
  },

  surfing: {
    weights: { waveHeight: 40, swellPeriod: 20, wind: 20, temperature: 10, rain: 10 },
    /** Highest wave of the day, metres: best around 1.5 to 2.5, too big is as bad as too small */
    waveM: [
      [0, 0],
      [0.3, 8],
      [0.6, 35],
      [1, 65],
      [1.5, 90],
      [2, 100],
      [2.5, 96],
      [3.5, 72],
      [4.5, 40],
      [6, 10],
    ] as Curve,
    /** A flat sea or a monster swell limits the day whatever else is good */
    waveLimitM: [
      [0, 5],
      [0.3, 15],
      [0.6, 45],
      [1, 75],
      [1.5, 100],
      [3, 100],
      [4, 70],
      [5, 45],
      [6, 25],
      [8, 10],
    ] as Curve,
    /** Swell period, seconds: long swell means clean, organised waves */
    periodS: [
      [4, 15],
      [6, 40],
      [8, 75],
      [10, 100],
      [14, 100],
    ] as Curve,
    /** Short-period waves are choppy */
    periodLimitS: [
      [4, 35],
      [6, 60],
      [8, 90],
      [10, 100],
    ] as Curve,
    /** Wind roughens the sea */
    windKmh: [
      [10, 100],
      [20, 88],
      [30, 60],
      [45, 25],
      [60, 5],
    ] as Curve,
    windLimitKmh: [
      [0, 100],
      [20, 100],
      [30, 80],
      [45, 50],
      [60, 25],
    ] as Curve,
    /** Warmest air temperature, degrees C */
    airTempC: [
      [0, 20],
      [8, 50],
      [14, 85],
      [18, 100],
    ] as Curve,
    rainMm: [
      [0, 100],
      [5, 80],
      [10, 50],
      [20, 10],
    ] as Curve,
    caps: { thunderstorm: 20 },
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
