import { dayOf } from '../../../test/support/builders';
import { DailyWeatherData } from '../../domain/daily-weather';
import { ratingFor } from './engine/helpers';
import { IndoorSightseeingScorer } from './scorers/indoor.scorer';
import { OutdoorSightseeingScorer } from './scorers/outdoor.scorer';
import { SkiingScorer } from './scorers/skiing.scorer';
import { SurfingScorer } from './scorers/surfing.scorer';
import { SCORING } from './config/scoring-config';
import { ActivityScorer, Rating } from './types';

/**
 * THE MODEL, PINNED BY EVERYDAY EXPECTATIONS.
 *
 * Each case is a realistic day and what a sensible person expects from it, in words:
 * "a downpour is bad for walking and great for museums". The expectations were written down BEFORE
 * looking at the numbers. Change a curve or weight in scoring-config.ts so that a typical day comes
 * out silly (a downpour that is fine for a walk) and these tests fail.
 *
 * Ratings: POOR (bad), FAIR (so-so), GOOD, GREAT. Where two ratings are listed, either is acceptable:
 * the day sits near the border and the exact side is not the point.
 */

const outdoor = new OutdoorSightseeingScorer();
const indoor = new IndoorSightseeingScorer();
const skiing = new SkiingScorer();
const surfing = new SurfingScorer();

const { POOR, FAIR, GOOD, GREAT } = Rating;
const PLAIN: Record<Rating, string> = { POOR: 'bad', FAIR: 'so-so', GOOD: 'good', GREAT: 'great' };
const say = (ratings: Rating[]): string => ratings.map((r) => PLAIN[r]).join(' or ');

const ratingOf = (scorer: ActivityScorer, day: DailyWeatherData): Rating => {
  const result = scorer.score(day);
  if (!result.available) throw new Error('expected an available score');
  return ratingFor(result.score);
};
const scoreOf = (scorer: ActivityScorer, day: DailyWeatherData): number => {
  const result = scorer.score(day);
  if (!result.available) throw new Error('expected an available score');
  return result.score;
};

/** A dry, calm day at the given temperature with the given sky; override anything else. */
const dry = (tempC: number, cloudPct: number, extra: Partial<DailyWeatherData> = {}) =>
  dayOf({
    apparentTempMaxC: tempC,
    tempMaxC: tempC,
    cloudCoverMeanPct: cloudPct,
    windMaxKmh: 10,
    precipitationMm: 0,
    weatherCode: cloudPct > 80 ? 3 : 1,
    ...extra,
  });

describe('Sightseeing: what a sensible person expects', () => {
  // [the day, how a WALK is, how a MUSEUM visit is]
  const days: [string, DailyWeatherData, Rating[], Rating[]][] = [
    ['perfect day: 21 C, clear, calm, dry', dry(21, 10), [GREAT], [FAIR, GOOD]],
    ['pleasant day: 18 C, partly cloudy', dry(18, 40), [GREAT], [FAIR, GOOD]],
    ['grey November day: dry, overcast, 12 C', dry(12, 100), [GOOD], [GOOD]],
    ['cold grey day: dry, overcast, 5 C', dry(5, 100), [FAIR, GOOD], [GOOD, GREAT]],
    ['fog, 4 C', dry(4, 100, { weatherCode: 45 }), [POOR, FAIR], [GOOD, GREAT]],
    ['bright but freezing: 0 C', dry(0, 10), [POOR, FAIR], [GOOD, GREAT]],
    [
      'drizzle: 1 mm, 15 C, cloudy',
      dry(15, 80, { precipitationMm: 1, weatherCode: 61 }),
      [GOOD],
      [GOOD],
    ],
    [
      'steady rain: 5 mm, 15 C',
      dry(15, 90, { precipitationMm: 5, weatherCode: 63 }),
      [POOR, FAIR],
      [GOOD, GREAT],
    ],
    [
      'downpour: 12 mm, 14 C',
      dry(14, 100, { precipitationMm: 12, weatherCode: 65 }),
      [POOR],
      [GREAT],
    ],
    ['hot, sunny: 35 C felt', dry(35, 5, { tempMaxC: 33 }), [FAIR, GOOD], [GOOD, GREAT]],
    ['scorching: 40 C felt', dry(40, 5, { tempMaxC: 38 }), [POOR, FAIR], [GREAT]],
    ['strong breeze: 45 km/h, 20 C', dry(20, 20, { windMaxKmh: 45 }), [GOOD], [GOOD]],
    ['storm wind: 70 km/h, 20 C', dry(20, 20, { windMaxKmh: 70 }), [POOR, FAIR], [GOOD, GREAT]],
    [
      'thunderstorm, 22 C',
      dry(22, 90, { weatherCode: 95, precipitationMm: 8 }),
      [POOR],
      [GOOD, GREAT],
    ],
    [
      'snowfall: 5 cm, -4 C',
      dry(-4, 95, { snowfallCm: 5, precipitationMm: 4, weatherCode: 73 }),
      [POOR],
      [GREAT],
    ],
  ];

  it.each(
    days.map(
      ([name, day, walk, museum]) =>
        [
          `${name}: a walk is ${say(walk)}, a museum visit is ${say(museum)}`,
          day,
          walk,
          museum,
        ] as const,
    ),
  )('%s', (_title, day, walk, museum) => {
    expect(walk).toContain(ratingOf(outdoor, day));
    expect(museum).toContain(ratingOf(indoor, day));
  });

  describe('which one wins: a walk or a museum', () => {
    const winner = (day: DailyWeatherData): 'a walk' | 'a museum' =>
      scoreOf(outdoor, day) > scoreOf(indoor, day) ? 'a walk' : 'a museum';

    const cases: [string, DailyWeatherData, 'a walk' | 'a museum'][] = [
      ['a pleasant dry day', dry(18, 40), 'a walk'],
      ['a mild overcast day', dry(12, 100), 'a walk'],
      ['a cold grey day', dry(5, 100), 'a museum'],
      ['fog', dry(4, 100, { weatherCode: 45 }), 'a museum'],
      ['steady rain', dry(15, 90, { precipitationMm: 5, weatherCode: 63 }), 'a museum'],
      ['a heatwave', dry(40, 5, { tempMaxC: 38 }), 'a museum'],
    ];

    it.each(
      cases.map(
        ([name, day, expected]) =>
          [`on ${name} the better plan is ${expected}`, day, expected] as const,
      ),
    )('%s', (_title, day, expected) => {
      expect(winner(day)).toBe(expected);
    });
  });

  describe('the worked examples in the README', () => {
    it('a grey dry day (12 C, overcast): walk 79, museum 68', () => {
      expect([scoreOf(outdoor, dry(12, 100)), scoreOf(indoor, dry(12, 100))]).toEqual([79, 68]);
    });

    it('a downpour (12 mm, 20 C): walk 18 (the rain limits it), museum 93', () => {
      const day = dry(20, 60, { precipitationMm: 12, weatherCode: 65 });
      expect([scoreOf(outdoor, day), scoreOf(indoor, day)]).toEqual([18, 93]);
    });
  });
});

type Case = [name: string, day: DailyWeatherData, expected: Rating[]];

/** Runs each case as its own test, titled with the expectation: "no snow: skiing is bad". */
function expectRatings(activity: string, scorer: ActivityScorer, cases: Case[]): void {
  it.each(
    cases.map(
      ([name, day, expected]) =>
        [`${name}: ${activity} is ${say(expected)}`, day, expected] as const,
    ),
  )('%s', (_title, day, expected) => {
    expect(expected).toContain(ratingOf(scorer, day));
  });
}

describe('Skiing: what a sensible person expects', () => {
  const ski = (extra: Partial<DailyWeatherData>) =>
    dayOf({
      snowDepthCm: 0,
      snowfallCm: 0,
      tempMaxC: -5,
      windMaxKmh: 10,
      precipitationMm: 0,
      cloudCoverMeanPct: 20,
      weatherCode: 1,
      ...extra,
    });

  expectRatings('skiing', skiing, [
    ['no snow at all, 8 C', ski({ tempMaxC: 8 }), [POOR]],
    ['only 4 cm of snow', ski({ snowDepthCm: 4 }), [POOR]],
    ['a thin base: 15 cm, -4 C', ski({ snowDepthCm: 15, tempMaxC: -4 }), [FAIR, GOOD]],
    ['a decent base: 40 cm, -5 C', ski({ snowDepthCm: 40 }), [GOOD, GREAT]],
    [
      'deep and fresh: 80 cm plus 10 cm new snow',
      ski({ snowDepthCm: 80, snowfallCm: 10 }),
      [GREAT],
    ],
    ['deep but warm and soft: 80 cm, +3 C', ski({ snowDepthCm: 80, tempMaxC: 3 }), [GOOD]],
    [
      'deep but a gale: 80 cm, 60 km/h wind',
      ski({ snowDepthCm: 80, windMaxKmh: 60 }),
      [FAIR, GOOD],
    ],
    [
      'rain on the snow: 80 cm, +4 C, 5 mm',
      ski({ snowDepthCm: 80, tempMaxC: 4, precipitationMm: 5 }),
      [POOR, FAIR],
    ],
  ]);
});

describe('Surfing: what a sensible person expects', () => {
  const surf = (extra: Partial<DailyWeatherData>) =>
    dayOf({
      waveHeightMaxM: 1.8,
      wavePeriodMaxS: 11,
      windMaxKmh: 10,
      tempMaxC: 18,
      precipitationMm: 0,
      weatherCode: 1,
      ...extra,
    });

  expectRatings('surfing', surfing, [
    ['a flat sea: 0.2 m waves', surf({ waveHeightMaxM: 0.2 }), [POOR]],
    ['small waves: 0.7 m', surf({ waveHeightMaxM: 0.7 }), [FAIR, GOOD]],
    ['clean 1.8 m waves with a long swell', surf({}), [GREAT]],
    ['1.8 m but choppy: short 5 s swell', surf({ wavePeriodMaxS: 5 }), [FAIR]],
    ['1.8 m but a strong 45 km/h wind', surf({ windMaxKmh: 45 }), [FAIR]],
    ['big waves: 4 m', surf({ waveHeightMaxM: 4 }), [GOOD]],
    ['huge waves: 6 m', surf({ waveHeightMaxM: 6 }), [POOR]],
    ['a thunderstorm', surf({ weatherCode: 95 }), [POOR]],
  ]);
});

describe('scoring model: fairness between activities', () => {
  const activities = {
    outdoor: SCORING.outdoor.weights,
    skiing: SCORING.skiing.weights,
    surfing: SCORING.surfing.weights,
  };

  it.each(Object.entries(activities))('%s is judged by five conditions', (_name, weights) => {
    expect(Object.keys(weights)).toHaveLength(5);
  });

  it.each(Object.entries(activities))('the weights of %s add up to 100', (_name, weights) => {
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('a missing measurement is left out, not punished', () => {
    const complete = scoreOf(outdoor, dry(20, 10));
    const withoutWind = scoreOf(outdoor, dry(20, 10, { windMaxKmh: null, gustMaxKmh: null }));
    expect(withoutWind).toBe(complete);
  });
});
