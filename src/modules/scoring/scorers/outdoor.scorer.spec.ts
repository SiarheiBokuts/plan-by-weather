import { dayOf } from '../../../../test/support/builders';
import { DailyWeatherData } from '../../../domain/daily-weather';
import { OutdoorSightseeingScorer } from './outdoor.scorer';

const scorer = new OutdoorSightseeingScorer();

function result(overrides: Partial<DailyWeatherData>) {
  const output = scorer.score(dayOf({ cloudCoverMeanPct: 20, ...overrides }));
  if (!output.available) throw new Error('expected an available score');
  return output;
}
const score = (overrides: Partial<DailyWeatherData>): number => result(overrides).score;
const texts = (overrides: Partial<DailyWeatherData>): string[] =>
  result(overrides).reasons.map((r) => r.text);

describe('OutdoorSightseeingScorer', () => {
  it('gives a dry, comfortable, bright, calm day nearly the top score and says why', () => {
    const output = result({});
    expect(output.score).toBeGreaterThanOrEqual(95);
    expect(output.reasons.map((r) => r.text)).toEqual(
      expect.arrayContaining(['Dry', 'Comfortable temperature (20 °C)', 'Sunny']),
    );
  });

  it('is unavailable without any weather data', () => {
    const output = scorer.score(
      dayOf({ tempMaxC: null, apparentTempMaxC: null, precipitationMm: null }),
    );
    expect(output).toEqual({ available: false, reason: 'No weather data for this day' });
  });

  describe('precipitation', () => {
    it.each([
      [1, 'Light rain (1.0 mm)'],
      [4, 'Rain (4.0 mm)'],
      [12, 'Heavy rain (12.0 mm)'],
    ])('%s mm of rain is reported as "%s"', (mm, text) => {
      expect(texts({ precipitationMm: mm })).toContain(text);
    });

    it('lowers the score the harder it rains', () => {
      const scores = [0, 1, 3, 6, 12].map((mm) => score({ precipitationMm: mm }));
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      expect(new Set(scores).size).toBe(scores.length);
    });

    it('treats snowfall as snow, not rain, so it is not counted twice', () => {
      const names = texts({ snowfallCm: 5, precipitationMm: 4 });
      expect(names).toContain('Snowfall (5 cm)');
      expect(names.some((t) => t.includes('rain'))).toBe(false);
    });

    it('says nothing about dryness when precipitation is unknown', () => {
      expect(texts({ precipitationMm: null })).not.toContain('Dry');
    });
  });

  describe('temperature', () => {
    it.each([
      [3, 'Cold (3 °C)'],
      [10, 'Cool (10 °C)'],
      [20, 'Comfortable temperature (20 °C)'],
      [30, 'Warm (30 °C)'],
      [34, 'Hot (34 °C)'],
    ])('a felt temperature of %s is described as "%s"', (felt, text) => {
      expect(texts({ apparentTempMaxC: felt })).toContain(text);
    });

    it('prefers the colder and the hotter extremes to a comfortable day', () => {
      const comfortable = score({ apparentTempMaxC: 21 });
      for (const felt of [-5, 3, 9, 30, 36, 40]) {
        expect(score({ apparentTempMaxC: felt })).toBeLessThan(comfortable);
      }
    });

    it('uses the felt temperature, falling back to the air temperature', () => {
      expect(score({ apparentTempMaxC: 2, tempMaxC: 20 })).toBeLessThan(score({ tempMaxC: 20 }));
      expect(texts({ apparentTempMaxC: null, tempMaxC: 3 })).toContain('Cold (3 °C)');
    });

    it('leaves the temperature out when it is unknown', () => {
      const output = result({ apparentTempMaxC: null, tempMaxC: null });
      expect(output.reasons.map((r) => r.text).some((t) => t.includes('°C'))).toBe(false);
    });
  });

  describe('sky', () => {
    it('scores a grey sky below a bright one and names it', () => {
      expect(score({ cloudCoverMeanPct: 100 })).toBeLessThan(score({ cloudCoverMeanPct: 50 }));
      expect(score({ cloudCoverMeanPct: 50 })).toBeLessThan(score({ cloudCoverMeanPct: 5 }));
      expect(texts({ cloudCoverMeanPct: 100 })).toContain('Overcast');
      expect(texts({ cloudCoverMeanPct: 5 })).toContain('Sunny');
    });

    it('says "Cloudy" for a heavy but not total cloud cover, and nothing for a so-so sky', () => {
      expect(texts({ cloudCoverMeanPct: 70 })).toContain('Cloudy');
      const names = texts({ cloudCoverMeanPct: 50 });
      expect(names).not.toContain('Cloudy');
      expect(names).not.toContain('Sunny');
    });

    it('falls back to hours of sunshine when cloud cover is unknown', () => {
      const day = { cloudCoverMeanPct: null };
      expect(texts({ ...day, sunshineSeconds: 8 * 3600 })).toContain('Sunny');
      expect(texts({ ...day, sunshineSeconds: 1.5 * 3600 })).toContain('Cloudy');
      expect(texts({ ...day, sunshineSeconds: 0 })).toContain('Overcast');
    });

    it('leaves the sky out when neither cloud cover nor sunshine is known', () => {
      const output = result({ cloudCoverMeanPct: null, sunshineSeconds: null });
      expect(output.reasons.map((r) => r.text)).not.toContain('Sunny');
    });
  });

  describe('wind and fog', () => {
    it('lowers the score in strong wind, with a ceiling, and names it', () => {
      expect(texts({ windMaxKmh: 50 })).toContain('Windy (50 km/h)');
      expect(score({ windMaxKmh: 50 })).toBeLessThanOrEqual(65);
      expect(score({ windMaxKmh: 20 })).toBeGreaterThan(score({ windMaxKmh: 50 }));
    });

    it('ignores the wind when it is unknown', () => {
      expect(score({ windMaxKmh: null })).toBeGreaterThanOrEqual(95);
    });

    it('lowers the score in fog, because the sights cannot be seen', () => {
      expect(texts({ weatherCode: 45 })).toContain('Fog');
      expect(score({ weatherCode: 45 })).toBeLessThan(score({ weatherCode: 1 }));
    });

    it('ignores the weather code when it is unknown', () => {
      expect(score({ weatherCode: null })).toBeGreaterThanOrEqual(95);
    });
  });

  describe('dealbreakers', () => {
    it('caps a thunderstorm day', () => {
      const output = result({ weatherCode: 95 });
      expect(output.score).toBeLessThanOrEqual(20);
      expect(output.reasons.map((r) => r.text)).toContain('Thunderstorm');
    });

    it('caps a day with violent gusts', () => {
      const output = result({ gustMaxKmh: 90 });
      expect(output.score).toBeLessThanOrEqual(40);
      expect(output.reasons.map((r) => r.text)).toContain('Violent gusts (90 km/h)');
    });

    it('does not cap ordinary gusts', () => {
      expect(score({ gustMaxKmh: 40 })).toBeGreaterThanOrEqual(95);
    });
  });

  it('never returns a score outside 0-100', () => {
    const awful = score({
      precipitationMm: 40,
      apparentTempMaxC: -25,
      windMaxKmh: 90,
      weatherCode: 99,
    });
    expect(awful).toBeGreaterThanOrEqual(0);
    expect(awful).toBeLessThanOrEqual(100);
  });
});
