import { dayOf } from '../../../../test/support/builders';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { IndoorSightseeingScorer } from './indoor.scorer';
import { OutdoorSightseeingScorer } from './outdoor.scorer';

const scorer = new IndoorSightseeingScorer();
const outdoor = new OutdoorSightseeingScorer();

function result(overrides: Partial<DailyWeatherData>) {
  const output = scorer.score(dayOf({ cloudCoverMeanPct: 20, ...overrides }));
  if (!output.available) throw new Error('expected an available score');
  return output;
}
const score = (overrides: Partial<DailyWeatherData>): number => result(overrides).score;
const outdoorScore = (overrides: Partial<DailyWeatherData>): number => {
  const output = outdoor.score(dayOf({ cloudCoverMeanPct: 20, ...overrides }));
  if (!output.available) throw new Error('expected an available score');
  return output.score;
};

describe('IndoorSightseeingScorer', () => {
  it('is a fair, always-available baseline on a lovely day, with a neutral reason', () => {
    const output = result({});
    expect(output.score).toBe(60);
    expect(output.reasons).toEqual([
      { text: 'Mild weather outside', impact: 'neutral', weight: 1 },
    ]);
  });

  it('gets better the worse it is outside', () => {
    const days = [{}, { cloudCoverMeanPct: 100 }, { precipitationMm: 5 }, { precipitationMm: 14 }];
    const scores = days.map((day) => score(day));
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(scores[3]).toBeGreaterThan(scores[0] + 25);
  });

  it('moves opposite to the outdoor score', () => {
    for (const felt of [-5, 5, 12, 21, 30, 38]) {
      const day = { apparentTempMaxC: felt, tempMaxC: felt };
      const out = outdoorScore(day);
      const delta = score(day) - 60;
      expect(delta).toBeCloseTo((100 - out) * 0.4, 0);
    }
  });

  it('turns the reasons that hurt outdoor plans into reasons for indoor plans', () => {
    const output = result({ precipitationMm: 12 });
    expect(output.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Heavy rain (12.0 mm)', impact: 'positive' }),
      ]),
    );
    expect(output.reasons.every((r) => r.impact === 'positive')).toBe(true);
  });

  describe('severe weather', () => {
    it.each([
      ['a thunderstorm', { weatherCode: 95 }],
      ['violent gusts', { gustMaxKmh: 80 }],
      ['heavy snowfall', { snowfallCm: 20 }],
    ])('subtracts for %s because getting there is risky', (_name, overrides) => {
      expect(result(overrides).reasons.map((r) => r.text)).toContain(
        'Severe weather, travel may be risky',
      );
    });

    it('ranks a severe day below an equally bad but safe one', () => {
      expect(score({ precipitationMm: 12, weatherCode: 95 })).toBeLessThan(
        score({ precipitationMm: 12 }),
      );
    });

    it('does not flag ordinary gusts', () => {
      expect(result({ gustMaxKmh: 60 }).reasons.map((r) => r.text)).not.toContain(
        'Severe weather, travel may be risky',
      );
    });
  });

  it('is unavailable when there is no weather to judge', () => {
    const output = scorer.score(
      dayOf({ tempMaxC: null, apparentTempMaxC: null, precipitationMm: null }),
    );
    expect(output).toEqual({ available: false, reason: 'No weather data for this day' });
  });
});
