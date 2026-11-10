import { dayOf } from '../../../test/support/builders';
import { OutdoorSightseeingScorer } from './outdoor.scorer';

const scorer = new OutdoorSightseeingScorer();

function score(overrides: Parameters<typeof dayOf>[0]) {
  const result = scorer.score(dayOf(overrides));
  if (!result.available) throw new Error('expected an available score');
  return result;
}

describe('OutdoorSightseeingScorer', () => {
  it('gives a dry, mild, calm, sunny day the top score', () => {
    const result = score({});
    expect(result.score).toBe(100);
    expect(result.reasons.map((r) => r.text)).toEqual(
      expect.arrayContaining(['Dry', 'Comfortable temperature (20 °C)', 'Sunny (8 h of sun)']),
    );
  });

  it('is unavailable without any weather data', () => {
    const result = scorer.score(
      dayOf({ tempMaxC: null, apparentTempMaxC: null, precipitationMm: null }),
    );
    expect(result).toEqual({ available: false, reason: 'No weather data for this day' });
  });

  describe('precipitation', () => {
    it.each([
      [1, 'Light rain (1.0 mm)'],
      [4, 'Rain (4.0 mm)'],
      [12, 'Heavy rain (12.0 mm)'],
    ])('%s mm of rain is reported as "%s" and lowers the score', (mm, text) => {
      const result = score({ precipitationMm: mm });
      expect(result.reasons.map((r) => r.text)).toContain(text);
      expect(result.score).toBeLessThan(90);
    });

    it('scores heavy rain as a poor outdoor day', () => {
      expect(score({ precipitationMm: 12 }).score).toBeLessThan(40);
    });

    it('lowers the score more the harder it rains', () => {
      expect(score({ precipitationMm: 5 }).score).toBeLessThan(score({ precipitationMm: 1 }).score);
    });

    it('treats snowfall as snow, not rain, so it is not penalised twice', () => {
      const result = score({ snowfallCm: 5, precipitationMm: 4 });
      const texts = result.reasons.map((r) => r.text);
      expect(texts).toContain('Snowfall (5 cm)');
      expect(texts.some((t) => t.includes('rain'))).toBe(false);
    });

    it('says nothing about dryness when precipitation is unknown', () => {
      const result = score({ precipitationMm: null });
      expect(result.reasons.map((r) => r.text)).not.toContain('Dry');
    });
  });

  describe('temperature', () => {
    it('penalises cold, using the felt temperature', () => {
      const result = score({ apparentTempMaxC: 2, tempMaxC: 8 });
      expect(result.reasons.map((r) => r.text)).toContain('Cold (2 °C)');
      expect(result.score).toBeLessThan(70);
    });

    it('caps the cold penalty', () => {
      expect(score({ apparentTempMaxC: -30 }).score).toBe(55);
    });

    it('penalises heat', () => {
      const result = score({ apparentTempMaxC: 34 });
      expect(result.reasons.map((r) => r.text)).toContain('Hot (34 °C)');
      expect(result.score).toBe(68);
    });

    it('falls back to the air temperature when the felt one is missing', () => {
      const result = score({ apparentTempMaxC: null, tempMaxC: 5 });
      expect(result.reasons.map((r) => r.text)).toContain('Cold (5 °C)');
    });

    it('skips the temperature factor when no temperature is known', () => {
      const result = score({ apparentTempMaxC: null, tempMaxC: null });
      expect(result.score).toBe(100);
    });
  });

  describe('wind, thunder and sun', () => {
    it('penalises strong wind', () => {
      const result = score({ windMaxKmh: 50 });
      expect(result.reasons.map((r) => r.text)).toContain('Windy (50 km/h)');
      expect(result.score).toBe(82);
    });

    it('ignores calm and unknown wind', () => {
      expect(score({ windMaxKmh: 25 }).score).toBe(100);
      expect(score({ windMaxKmh: null }).score).toBe(100);
    });

    it('caps a thunderstorm day', () => {
      const result = score({ weatherCode: 95 });
      expect(result.score).toBe(20);
      expect(result.reasons.map((r) => r.text)).toContain('Thunderstorm');
    });

    it('only mentions sun on a dry day with enough sunshine', () => {
      const dryGloomy = score({ sunshineSeconds: 3600 });
      expect(dryGloomy.reasons.map((r) => r.text).some((t) => t.startsWith('Sunny'))).toBe(false);
      const wetSunny = score({ sunshineSeconds: 9 * 3600, precipitationMm: 5 });
      expect(wetSunny.reasons.map((r) => r.text).some((t) => t.startsWith('Sunny'))).toBe(false);
      const noSunData = score({ sunshineSeconds: null });
      expect(noSunData.reasons.map((r) => r.text).some((t) => t.startsWith('Sunny'))).toBe(false);
    });
  });

  it('never returns a score outside 0-100', () => {
    const awful = score({
      precipitationMm: 40,
      apparentTempMaxC: -25,
      windMaxKmh: 90,
      weatherCode: 99,
    });
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(awful.score).toBeLessThanOrEqual(100);
  });
});
