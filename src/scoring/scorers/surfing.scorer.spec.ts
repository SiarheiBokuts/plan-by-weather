import { dayOf } from '../../../test/support/builders';
import { SurfingScorer, waveHeightPoints } from './surfing.scorer';

const scorer = new SurfingScorer();

function score(overrides: Parameters<typeof dayOf>[0]) {
  const result = scorer.score(dayOf({ waveHeightMaxM: 1.8, wavePeriodMaxS: 11, ...overrides }));
  if (!result.available) throw new Error('expected an available score');
  return result;
}

const texts = (overrides: Parameters<typeof dayOf>[0]): string[] =>
  score(overrides).reasons.map((r) => r.text);

describe('waveHeightPoints', () => {
  it.each([
    [0.1, 5],
    [0.3, 5],
    [1, 50],
    [2.5, 70],
    [4, 40],
    [6, 20],
  ])('a %s m wave is worth %s points', (height, points) => {
    expect(waveHeightPoints(height)).toBeCloseTo(points, 5);
  });

  it('rises from tiny to ideal and falls again when waves get too big', () => {
    expect(waveHeightPoints(0.7)).toBeGreaterThan(waveHeightPoints(0.4));
    expect(waveHeightPoints(1.8)).toBeGreaterThan(waveHeightPoints(0.7));
    expect(waveHeightPoints(3.2)).toBeLessThan(waveHeightPoints(2.5));
    expect(waveHeightPoints(5)).toBeLessThan(waveHeightPoints(3.2));
  });
});

describe('SurfingScorer', () => {
  it('is unavailable without wave data', () => {
    const result = scorer.score(dayOf({ waveHeightMaxM: null }));
    expect(result).toEqual({ available: false, reason: 'No wave data for this location' });
  });

  it('gives clean mid-sized waves with a long swell a great score', () => {
    const result = score({ windMaxKmh: 10, tempMaxC: 18 });
    expect(result.score).toBe(91);
    expect(result.reasons.map((r) => r.text)).toEqual(['Good waves (1.8 m)', 'Long swell (11 s)']);
  });

  describe('wave size', () => {
    it.each([
      [0.2, 'Very small waves (0.2 m)'],
      [0.7, 'Small waves (0.7 m)'],
      [1.8, 'Good waves (1.8 m)'],
      [3.2, 'Big waves (3.2 m)'],
      [5, 'Waves too big (5.0 m)'],
    ])('%s m waves are described as "%s"', (height, text) => {
      expect(texts({ waveHeightMaxM: height })).toContain(text);
    });

    it('scores tiny and giant waves lower than good ones', () => {
      const good = score({ waveHeightMaxM: 1.8 }).score;
      expect(score({ waveHeightMaxM: 0.2 }).score).toBeLessThan(good);
      expect(score({ waveHeightMaxM: 5 }).score).toBeLessThan(good);
    });
  });

  describe('swell period', () => {
    it('rewards a longer period', () => {
      expect(score({ wavePeriodMaxS: 12 }).score).toBeGreaterThan(
        score({ wavePeriodMaxS: 6 }).score,
      );
    });

    it('still scores when the period is unknown', () => {
      const result = score({ wavePeriodMaxS: null });
      expect(result.reasons.map((r) => r.text)).toEqual(['Good waves (1.8 m)']);
    });

    it('only calls the swell long from 9 seconds', () => {
      expect(texts({ wavePeriodMaxS: 7 }).some((t) => t.startsWith('Long swell'))).toBe(false);
    });
  });

  describe('conditions', () => {
    it('penalises strong wind', () => {
      expect(texts({ windMaxKmh: 55 })).toContain('Strong wind (55 km/h)');
      expect(score({ windMaxKmh: 55 }).score).toBeLessThan(score({ windMaxKmh: 10 }).score);
    });

    it('ignores light and unknown wind', () => {
      expect(texts({ windMaxKmh: 20 }).some((t) => t.startsWith('Strong wind'))).toBe(false);
      expect(texts({ windMaxKmh: null }).some((t) => t.startsWith('Strong wind'))).toBe(false);
    });

    it('penalises cold air', () => {
      expect(texts({ tempMaxC: 4 })).toContain('Cold air (4 °C)');
    });

    it('does not mention cold when mild or unknown', () => {
      expect(texts({ tempMaxC: 18 }).some((t) => t.startsWith('Cold'))).toBe(false);
      expect(texts({ tempMaxC: null }).some((t) => t.startsWith('Cold'))).toBe(false);
    });

    it('penalises heavy rain', () => {
      expect(texts({ precipitationMm: 15 })).toContain('Heavy rain');
    });

    it('caps the score in a thunderstorm', () => {
      const result = score({ weatherCode: 95 });
      expect(result.score).toBe(20);
      expect(result.reasons.map((r) => r.text)).toContain('Thunderstorm');
    });
  });
});
