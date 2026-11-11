import { dayOf } from '../../../../test/support/builders';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { combine, Factor } from './model';
import { IndoorSightseeingScorer } from '../scorers/indoor.scorer';
import { OutdoorSightseeingScorer } from '../scorers/outdoor.scorer';
import { SkiingScorer } from '../scorers/skiing.scorer';
import { SurfingScorer } from '../scorers/surfing.scorer';
import { ActivityScorer } from '../types';

function breakdownOf(scorer: ActivityScorer, day: DailyWeatherData) {
  const output = scorer.score(day);
  if (!output.available) throw new Error('expected an available score');
  return { score: output.score, ...output.breakdown };
}

const greyDay = dayOf({
  apparentTempMaxC: 12,
  tempMaxC: 12,
  cloudCoverMeanPct: 100,
  precipitationMm: 0,
  windMaxKmh: 10,
  weatherCode: 3,
});

describe('The breakdown that explains a score', () => {
  describe('for a measured activity (a grey dry day, outdoor sightseeing)', () => {
    const result = breakdownOf(new OutdoorSightseeingScorer(), greyDay);
    const line = (label: string) => result.factors.find((f) => f.label === label)!;

    it('lists every condition with what was measured', () => {
      expect(result.factors.map((f) => [f.label, f.value])).toEqual([
        ['Rain', '0.0 mm'],
        ['Temperature', '12 °C felt'],
        ['Sky', '100% cloud'],
        ['Wind', '10 km/h'],
        ['Visibility', 'clear'],
      ]);
    });

    it('gives each condition its mark, its share of the 100 points and the points it earned', () => {
      expect(line('Rain')).toMatchObject({ mark: 100, weight: 30, points: 30 });
      expect(line('Temperature')).toMatchObject({ mark: 73.5, weight: 35, points: 25.7 });
      expect(line('Sky')).toMatchObject({ mark: 25, weight: 15, points: 3.8 });
    });

    it('adds up: the points of the conditions are the points of the day', () => {
      const sum = result.factors.reduce((total, f) => total + f.points, 0);
      expect(sum).toBeCloseTo(result.points, 0);
      expect(result.points).toBeCloseTo(79.5, 1);
      expect(result.score).toBe(79);
    });

    it('says nothing was limiting when no ceiling is lower than the points', () => {
      expect(result.limitedBy).toBeNull();
    });
  });

  describe('when a condition sets a ceiling', () => {
    const downpour = dayOf({
      apparentTempMaxC: 20,
      tempMaxC: 20,
      cloudCoverMeanPct: 60,
      precipitationMm: 12,
      windMaxKmh: 10,
      weatherCode: 65,
    });
    const result = breakdownOf(new OutdoorSightseeingScorer(), downpour);

    it('shows the points before the ceiling, the ceiling, and what caused it', () => {
      expect(result.points).toBeCloseTo(67.1, 1);
      expect(result.score).toBe(18);
      expect(result.limitedBy).toBe('Rain limits the day: at most 18');
      expect(result.factors.find((f) => f.label === 'Rain')!.limit).toBeCloseTo(18, 0);
    });

    it('names a dealbreaker when that is what limited the score', () => {
      const storm = breakdownOf(new OutdoorSightseeingScorer(), {
        ...downpour,
        precipitationMm: 1,
        weatherCode: 95,
      });
      expect(storm.limitedBy).toBe('Thunderstorm: at most 20');
    });
  });

  describe('when a measurement is missing', () => {
    it('keeps the line, marks it as having no data, and gives it no points', () => {
      const result = breakdownOf(new OutdoorSightseeingScorer(), { ...greyDay, windMaxKmh: null });
      const wind = result.factors.find((f) => f.label === 'Wind')!;
      expect(wind).toMatchObject({ value: null, mark: null, weight: null, points: 0, limit: null });
    });

    it('shares the 100 points among the conditions that remain', () => {
      const result = breakdownOf(new OutdoorSightseeingScorer(), { ...greyDay, windMaxKmh: null });
      const weights = result.factors.map((f) => f.weight ?? 0);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    });
  });

  describe('for skiing and surfing', () => {
    it('explains skiing by snow, new snow, temperature, wind and visibility', () => {
      const result = breakdownOf(
        new SkiingScorer(),
        dayOf({ snowDepthCm: 80, snowfallCm: 10, tempMaxC: -6, windMaxKmh: 10, weatherCode: 1 }),
      );
      expect(result.factors.map((f) => f.label)).toEqual([
        'Snow on the ground',
        'New snow',
        'Temperature',
        'Wind',
        'Visibility',
      ]);
      expect(result.factors[0].value).toBe('80 cm');
    });

    it('names the missing snow as the limit when there is none', () => {
      const result = breakdownOf(
        new SkiingScorer(),
        dayOf({ snowDepthCm: 0, snowfallCm: 0, tempMaxC: 8 }),
      );
      expect(result.limitedBy).toBe('No snow on the ground: at most 5');
    });

    it('explains surfing by waves, swell, wind, temperature and rain', () => {
      const result = breakdownOf(
        new SurfingScorer(),
        dayOf({
          waveHeightMaxM: 1.8,
          wavePeriodMaxS: 11,
          windMaxKmh: 10,
          tempMaxC: 18,
          precipitationMm: 0,
        }),
      );
      expect(result.factors.map((f) => f.label)).toEqual([
        'Wave height',
        'Swell period',
        'Wind',
        'Air temperature',
        'Rain',
      ]);
      expect(result.factors[0].value).toBe('1.8 m');
    });
  });

  describe('for indoor sightseeing, which is a short sum instead of weighted conditions', () => {
    const scorer = new IndoorSightseeingScorer();

    it('starts from the baseline and adds what the bad weather outside earns', () => {
      const result = breakdownOf(
        scorer,
        dayOf({ precipitationMm: 12, apparentTempMaxC: 14, tempMaxC: 14, cloudCoverMeanPct: 100 }),
      );
      expect(result.factors.map((f) => f.label)).toEqual([
        'Always an option',
        'Bad weather outside',
      ]);
      expect(result.factors[0]).toMatchObject({ points: 60, mark: null, weight: null });
      expect(result.factors[1].value).toMatch(/^outdoor scores \d+$/);
      expect(result.points).toBeCloseTo(result.factors[0].points + result.factors[1].points, 0);
    });

    it('subtracts when it is dangerous to travel', () => {
      const result = breakdownOf(scorer, dayOf({ weatherCode: 95, precipitationMm: 8 }));
      const danger = result.factors.find((f) => f.label === 'Dangerous to travel')!;
      expect(danger.points).toBe(-15);
    });
  });

  describe('combine()', () => {
    it('returns an empty breakdown for no conditions', () => {
      expect(combine([]).breakdown).toEqual({ factors: [], points: 0, limitedBy: null });
    });

    it('reports the lowest of several ceilings', () => {
      const factors: Factor[] = [
        { label: 'A', weight: 1, score: 90, good: null, bad: null, limit: 60 },
        { label: 'B', weight: 1, score: 90, good: null, bad: null, limit: 40 },
      ];
      expect(combine(factors).breakdown.limitedBy).toBe('B limits the day: at most 40');
    });
  });
});
