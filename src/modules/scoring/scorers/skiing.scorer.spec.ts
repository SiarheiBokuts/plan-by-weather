import { dayOf } from '../../../../test/support/builders';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { SkiingScorer } from './skiing.scorer';

const scorer = new SkiingScorer();

const ski = (overrides: Partial<DailyWeatherData>): DailyWeatherData =>
  dayOf({
    snowDepthCm: 50,
    snowfallCm: 0,
    tempMaxC: -5,
    windMaxKmh: 10,
    precipitationMm: 0,
    weatherCode: 1,
    ...overrides,
  });

function result(overrides: Partial<DailyWeatherData>) {
  const output = scorer.score(ski(overrides));
  if (!output.available) throw new Error('expected an available score');
  return output;
}
const score = (overrides: Partial<DailyWeatherData>): number => result(overrides).score;
const texts = (overrides: Partial<DailyWeatherData>): string[] =>
  result(overrides).reasons.map((r) => r.text);

describe('SkiingScorer', () => {
  it('is unavailable when there is no snow data at all', () => {
    expect(scorer.score(dayOf({ snowDepthCm: null, snowfallCm: null }))).toEqual({
      available: false,
      reason: 'No snow data for this location',
    });
  });

  describe('without snow', () => {
    it('scores a day with no snow very low and says so', () => {
      const output = result({ snowDepthCm: 0, tempMaxC: 8 });
      expect(output.score).toBe(5);
      expect(output.reasons).toContainEqual(
        expect.objectContaining({ text: 'No snow on the ground', impact: 'negative' }),
      );
    });

    it('treats a thin dusting below the minimum as no snow', () => {
      expect(score({ snowDepthCm: 3, snowfallCm: 1 })).toBe(5);
    });

    it('is workable with fresh snowfall even when the depth is unknown', () => {
      const output = result({ snowDepthCm: null, snowfallCm: 10 });
      expect(output.score).toBeGreaterThan(5);
      expect(output.reasons.map((r) => r.text)).toContain('Fresh snow (10 cm)');
    });
  });

  describe('snow', () => {
    it('rewards a deeper base, and a thin base limits the day', () => {
      const scores = [10, 20, 40, 80].map((cm) => score({ snowDepthCm: cm }));
      expect([...scores].sort((a, b) => a - b)).toEqual(scores);
      expect(score({ snowDepthCm: 15 })).toBeLessThanOrEqual(60);
    });

    it('rewards fresh snow and names both depth and new snow', () => {
      expect(score({ snowfallCm: 10 })).toBeGreaterThan(score({ snowfallCm: 0 }));
      expect(texts({ snowDepthCm: 80, snowfallCm: 10 })).toEqual(
        expect.arrayContaining(['Snow depth 80 cm', 'Fresh snow (10 cm)']),
      );
    });
  });

  describe('temperature', () => {
    it('lowers the score in warm weather that softens the snow, and names it', () => {
      expect(texts({ tempMaxC: 8 })).toContain('Warm (8 °C), snow may be soft');
      expect(score({ tempMaxC: 8 })).toBeLessThan(score({ tempMaxC: -5 }));
      expect(score({ tempMaxC: 3 })).toBeLessThanOrEqual(70);
    });

    it('lowers the score a little in extreme cold', () => {
      expect(texts({ tempMaxC: -20 })).toContain('Very cold (-20 °C)');
      expect(score({ tempMaxC: -20 })).toBeLessThan(score({ tempMaxC: -5 }));
    });

    it('says nothing about ideal temperatures, and copes with an unknown one', () => {
      expect(texts({ tempMaxC: -5 }).some((t) => /Warm|cold/.test(t))).toBe(false);
      expect(score({ tempMaxC: null })).toBeGreaterThan(80);
    });
  });

  describe('wind and visibility', () => {
    it('lowers the score in strong wind and names it', () => {
      expect(texts({ windMaxKmh: 70 })).toContain('Windy (70 km/h)');
      expect(score({ windMaxKmh: 60 })).toBeLessThanOrEqual(60);
      expect(score({ windMaxKmh: 10 })).toBeGreaterThan(score({ windMaxKmh: 60 }));
    });

    it('copes with unknown wind', () => {
      expect(score({ windMaxKmh: null })).toBeGreaterThan(80);
    });

    it('lowers the score in fog, and copes with an unknown weather code', () => {
      expect(texts({ weatherCode: 45 })).toContain('Fog');
      expect(score({ weatherCode: 45 })).toBeLessThan(score({ weatherCode: 1 }));
      expect(score({ weatherCode: null })).toBeGreaterThan(80);
    });
  });

  describe('rain on snow', () => {
    it('caps the score and names it', () => {
      const output = result({ tempMaxC: 4, precipitationMm: 5 });
      expect(output.score).toBeLessThanOrEqual(45);
      expect(output.reasons.map((r) => r.text)).toContain('Rain on snow');
    });

    it('does not apply when the precipitation is mostly fresh snow', () => {
      expect(texts({ tempMaxC: 4, precipitationMm: 5, snowfallCm: 8 })).not.toContain(
        'Rain on snow',
      );
    });
  });

  it('never returns a score outside 0-100', () => {
    for (const extra of [
      { snowDepthCm: 500, snowfallCm: 200 },
      { snowDepthCm: 0, tempMaxC: 30 },
    ]) {
      expect(score(extra)).toBeGreaterThanOrEqual(0);
      expect(score(extra)).toBeLessThanOrEqual(100);
    }
  });
});
