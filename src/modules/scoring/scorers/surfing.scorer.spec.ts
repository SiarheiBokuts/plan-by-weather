import { dayOf } from '../../../../test/support/builders';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { SurfingScorer } from './surfing.scorer';

const scorer = new SurfingScorer();

const surf = (overrides: Partial<DailyWeatherData>): DailyWeatherData =>
  dayOf({
    waveHeightMaxM: 1.8,
    wavePeriodMaxS: 11,
    windMaxKmh: 10,
    tempMaxC: 18,
    precipitationMm: 0,
    weatherCode: 1,
    ...overrides,
  });

function result(overrides: Partial<DailyWeatherData>) {
  const output = scorer.score(surf(overrides));
  if (!output.available) throw new Error('expected an available score');
  return output;
}
const score = (overrides: Partial<DailyWeatherData>): number => result(overrides).score;
const texts = (overrides: Partial<DailyWeatherData>): string[] =>
  result(overrides).reasons.map((r) => r.text);

describe('SurfingScorer', () => {
  it('is unavailable without wave data', () => {
    expect(scorer.score(dayOf({ waveHeightMaxM: null }))).toEqual({
      available: false,
      reason: 'No wave data for this location',
    });
  });

  it('gives clean mid-sized waves with a long swell a great score and says why', () => {
    const output = result({});
    expect(output.score).toBeGreaterThanOrEqual(92);
    expect(output.reasons.map((r) => r.text)).toEqual(
      expect.arrayContaining(['Good waves (1.8 m)', 'Long swell (11 s)']),
    );
  });

  describe('wave size', () => {
    it.each([
      [0.2, 'Very small waves (0.2 m)'],
      [0.7, 'Small waves (0.7 m)'],
      [1.8, 'Good waves (1.8 m)'],
      [4, 'Big waves (4.0 m)'],
      [6, 'Waves too big (6.0 m)'],
    ])('%s m waves are described as "%s"', (height, text) => {
      expect(texts({ waveHeightMaxM: height })).toContain(text);
    });

    it('rises from flat to ideal and falls again when the waves get too big', () => {
      const up = [0.2, 0.6, 1, 1.5, 2].map((m) => score({ waveHeightMaxM: m }));
      expect([...up].sort((a, b) => a - b)).toEqual(up);
      const down = [2.5, 3.5, 4.5, 6].map((m) => score({ waveHeightMaxM: m }));
      expect([...down].sort((a, b) => b - a)).toEqual(down);
    });

    it('limits a flat sea to a very low score whatever else is good', () => {
      expect(score({ waveHeightMaxM: 0.2 })).toBeLessThanOrEqual(20);
    });
  });

  describe('swell period', () => {
    it('rewards a longer period, and short choppy waves limit the day', () => {
      expect(score({ wavePeriodMaxS: 12 })).toBeGreaterThan(score({ wavePeriodMaxS: 6 }));
      expect(score({ wavePeriodMaxS: 5 })).toBeLessThanOrEqual(58);
    });

    it('still scores when the period is unknown', () => {
      const output = result({ wavePeriodMaxS: null });
      expect(output.reasons.map((r) => r.text)).toEqual(['Good waves (1.8 m)']);
    });

    it('only calls the swell long from 9 seconds', () => {
      expect(texts({ wavePeriodMaxS: 7 }).some((t) => t.startsWith('Long swell'))).toBe(false);
    });
  });

  describe('wind, temperature and rain', () => {
    it('lowers the score in strong wind, with a ceiling, and names it', () => {
      expect(texts({ windMaxKmh: 55 })).toContain('Strong wind (55 km/h)');
      expect(score({ windMaxKmh: 45 })).toBeLessThanOrEqual(55);
      expect(score({ windMaxKmh: 10 })).toBeGreaterThan(score({ windMaxKmh: 45 }));
    });

    it('lowers the score in cold air and names it', () => {
      expect(texts({ tempMaxC: 3 })).toContain('Cold air (3 °C)');
      expect(score({ tempMaxC: 3 })).toBeLessThan(score({ tempMaxC: 18 }));
    });

    it('lowers the score in heavy rain', () => {
      expect(texts({ precipitationMm: 15 })).toContain('Heavy rain');
      expect(score({ precipitationMm: 15 })).toBeLessThan(score({ precipitationMm: 0 }));
    });

    it('copes with unknown wind, temperature and rain', () => {
      expect(score({ windMaxKmh: null, tempMaxC: null, precipitationMm: null })).toBeGreaterThan(
        85,
      );
    });
  });

  it('caps the score in a thunderstorm', () => {
    const output = result({ weatherCode: 95 });
    expect(output.score).toBeLessThanOrEqual(20);
    expect(output.reasons.map((r) => r.text)).toContain('Thunderstorm');
  });
});
