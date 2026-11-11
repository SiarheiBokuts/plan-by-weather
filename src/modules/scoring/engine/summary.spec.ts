import { buildSummary } from './summary';
import { Activity, Rating, Reason } from '../types';

const reason = (text: string, impact: Reason['impact'], weight: number): Reason => ({
  text,
  impact,
  weight,
});

describe('buildSummary', () => {
  it('names the factor that mattered most, then gives the verdict', () => {
    const summary = buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.POOR, [
      reason('Light wind', 'negative', 2),
      reason('Heavy rain (12.0 mm)', 'negative', 66),
      reason('Dry', 'positive', 10),
    ]);
    expect(summary).toBe('Heavy rain (12.0 mm): not a day for walking around.');
  });

  it('works for a great day too', () => {
    const summary = buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.GREAT, [
      reason('Dry', 'positive', 8),
      reason('Comfortable temperature (20 °C)', 'positive', 10),
    ]);
    expect(summary).toBe('Comfortable temperature (20 °C): great for exploring outside.');
  });

  it('says "but" when the main factor points against the verdict', () => {
    expect(
      buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.GOOD, [
        reason('Overcast', 'negative', 40),
        reason('Dry', 'positive', 5),
      ]),
    ).toBe('Overcast, but good for exploring outside.');
    expect(
      buildSummary(Activity.SKIING, Rating.FAIR, [reason('Snow depth 20 cm', 'positive', 15)]),
    ).toBe('Snow depth 20 cm, but marginal for skiing.');
  });

  it('puts a cold, grey day into words instead of praising its dryness', () => {
    expect(
      buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.FAIR, [
        reason('Cold (3 °C)', 'negative', 700),
        reason('Dry', 'positive', 100),
      ]),
    ).toBe('Cold (3 °C): so-so for being outside.');
  });

  it('uses the fitting verdict for every activity', () => {
    expect(buildSummary(Activity.INDOOR_SIGHTSEEING, Rating.GREAT, [])).toBe(
      'A perfect day for museums and indoor plans.',
    );
    expect(buildSummary(Activity.SKIING, Rating.POOR, [])).toBe('Not a ski day.');
    expect(buildSummary(Activity.SURFING, Rating.FAIR, [])).toBe('Marginal for surfing.');
  });

  it('uses a colon for a neutral headline', () => {
    expect(
      buildSummary(Activity.INDOOR_SIGHTSEEING, Rating.GOOD, [
        reason('Mild weather outside', 'neutral', 1),
      ]),
    ).toBe('Mild weather outside: a good day for museums and indoor plans.');
  });

  it('still produces a sentence when there are no reasons', () => {
    expect(buildSummary(Activity.SKIING, Rating.GOOD, [])).toBe('Good for skiing.');
  });
});
