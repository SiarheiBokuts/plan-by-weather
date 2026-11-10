import { dayOf } from '../../../test/support/builders';
import { IndoorSightseeingScorer } from './indoor.scorer';
import { OutdoorSightseeingScorer } from './outdoor.scorer';

const scorer = new IndoorSightseeingScorer();
const outdoor = new OutdoorSightseeingScorer();

function score(overrides: Parameters<typeof dayOf>[0]) {
  const result = scorer.score(dayOf(overrides));
  if (!result.available) throw new Error('expected an available score');
  return result;
}

const outdoorScore = (overrides: Parameters<typeof dayOf>[0]): number => {
  const result = outdoor.score(dayOf(overrides));
  if (!result.available) throw new Error('expected an available score');
  return result.score;
};

describe('IndoorSightseeingScorer', () => {
  it('is a fine baseline on a mild day, with a neutral reason', () => {
    const result = score({});
    expect(result.score).toBe(60);
    expect(result.reasons).toEqual([
      { text: 'Mild weather outside', impact: 'neutral', weight: 1 },
    ]);
  });

  it('scores a rainy day higher than a mild one', () => {
    expect(score({ precipitationMm: 12 }).score).toBeGreaterThan(score({}).score);
  });

  it('scores a very cold day higher than a mild one', () => {
    expect(score({ apparentTempMaxC: -5, tempMaxC: -3 }).score).toBeGreaterThan(score({}).score);
  });

  it('turns the reasons that hurt outdoor plans into reasons for indoor plans', () => {
    const result = score({ precipitationMm: 12 });
    expect(result.reasons).toEqual([
      expect.objectContaining({ text: 'Heavy rain (12.0 mm)', impact: 'positive' }),
    ]);
  });

  it('moves opposite to the outdoor score', () => {
    const mild = { precipitationMm: 0 };
    const wet = { precipitationMm: 8 };
    expect(outdoorScore(wet)).toBeLessThan(outdoorScore(mild));
    expect(score(wet).score).toBeGreaterThan(score(mild).score);
  });

  describe('severe weather', () => {
    it.each([
      ['a thunderstorm', { weatherCode: 95 }],
      ['violent gusts', { gustMaxKmh: 80 }],
      ['heavy snowfall', { snowfallCm: 20 }],
    ])('subtracts for %s because getting there is risky', (_name, overrides) => {
      const result = score(overrides);
      expect(result.reasons.map((r) => r.text)).toContain('Severe weather, travel may be risky');
    });

    it('ranks a severe day below an equally bad but safe one', () => {
      const safeRain = score({ precipitationMm: 12 });
      const stormy = score({ precipitationMm: 12, weatherCode: 95 });
      expect(stormy.score).toBeLessThan(safeRain.score);
    });

    it('does not flag ordinary gusts', () => {
      const result = score({ gustMaxKmh: 60 });
      expect(result.reasons.map((r) => r.text)).not.toContain(
        'Severe weather, travel may be risky',
      );
    });
  });

  it('is unavailable when there is no weather to judge', () => {
    const result = scorer.score(
      dayOf({ tempMaxC: null, apparentTempMaxC: null, precipitationMm: null }),
    );
    expect(result).toEqual({ available: false, reason: 'No weather data for this day' });
  });
});
