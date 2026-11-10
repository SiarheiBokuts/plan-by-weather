import { dayOf } from '../../../test/support/builders';
import { SkiingScorer } from './skiing.scorer';

const scorer = new SkiingScorer();

function score(overrides: Parameters<typeof dayOf>[0]) {
  const result = scorer.score(dayOf(overrides));
  if (!result.available) throw new Error('expected an available score');
  return result;
}

const texts = (overrides: Parameters<typeof dayOf>[0]): string[] =>
  score(overrides).reasons.map((r) => r.text);

describe('SkiingScorer', () => {
  it('is unavailable when there is no snow data at all', () => {
    const result = scorer.score(dayOf({ snowDepthCm: null, snowfallCm: null }));
    expect(result).toEqual({ available: false, reason: 'No snow data for this location' });
  });

  it('scores a day without snow very low and says so', () => {
    const result = score({ snowDepthCm: 0, snowfallCm: 0 });
    expect(result.score).toBe(5);
    expect(result.reasons).toEqual([
      { text: 'No snow on the ground', impact: 'negative', weight: 100 },
    ]);
  });

  it('treats a thin dusting below the minimum as no snow', () => {
    expect(score({ snowDepthCm: 3, snowfallCm: 1 }).score).toBe(5);
  });

  it('gives deep fresh snow in the cold a great score', () => {
    const result = score({ snowDepthCm: 80, snowfallCm: 10, tempMaxC: -5, windMaxKmh: 10 });
    expect(result.score).toBe(95);
    expect(result.reasons.map((r) => r.text)).toEqual(['Snow depth 80 cm', 'Fresh snow (10 cm)']);
  });

  it('is workable with fresh snowfall even when the depth is unknown', () => {
    const result = score({ snowDepthCm: null, snowfallCm: 6, tempMaxC: -3 });
    expect(result.reasons.map((r) => r.text)).toEqual(['Fresh snow (6 cm)']);
    expect(result.score).toBeGreaterThan(35);
  });

  it('rewards more snow on the ground', () => {
    expect(score({ snowDepthCm: 40, tempMaxC: -4 }).score).toBeGreaterThan(
      score({ snowDepthCm: 10, tempMaxC: -4 }).score,
    );
  });

  describe('temperature', () => {
    it('penalises warm weather that softens the snow', () => {
      expect(texts({ snowDepthCm: 50, tempMaxC: 8 })).toContain('Warm (8 °C), snow may be soft');
      expect(score({ snowDepthCm: 50, tempMaxC: 8 }).score).toBeLessThan(
        score({ snowDepthCm: 50, tempMaxC: -4 }).score,
      );
    });

    it('caps the warmth penalty', () => {
      expect(score({ snowDepthCm: 60, snowfallCm: 0, tempMaxC: 25 }).score).toBe(60);
    });

    it('penalises extreme cold a little', () => {
      expect(texts({ snowDepthCm: 50, tempMaxC: -20 })).toContain('Very cold (-20 °C)');
    });

    it('does not mention temperature when it is unknown or ideal', () => {
      expect(texts({ snowDepthCm: 50, tempMaxC: null }).some((t) => /Warm|cold/.test(t))).toBe(
        false,
      );
      expect(texts({ snowDepthCm: 50, tempMaxC: -5 }).some((t) => /Warm|cold/.test(t))).toBe(false);
    });
  });

  it('penalises strong wind but not calm or unknown wind', () => {
    expect(texts({ snowDepthCm: 50, tempMaxC: -5, windMaxKmh: 70 })).toContain('Windy (70 km/h)');
    expect(texts({ snowDepthCm: 50, tempMaxC: -5, windMaxKmh: 20 })).not.toContain(
      'Windy (20 km/h)',
    );
    expect(texts({ snowDepthCm: 50, tempMaxC: -5, windMaxKmh: null }).length).toBeGreaterThan(0);
  });

  it('penalises rain falling on the snow', () => {
    const wet = score({ snowDepthCm: 30, snowfallCm: 0, precipitationMm: 5, tempMaxC: 3 });
    expect(wet.reasons.map((r) => r.text)).toContain('Rain on snow');
    expect(wet.score).toBe(40);
  });

  it('does not call precipitation rain when it is mostly fresh snow', () => {
    expect(
      texts({ snowDepthCm: 30, snowfallCm: 8, precipitationMm: 5, tempMaxC: 3 }),
    ).not.toContain('Rain on snow');
  });

  it('never returns a score outside 0-100', () => {
    const result = score({
      snowDepthCm: 500,
      snowfallCm: 200,
      tempMaxC: -5,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
