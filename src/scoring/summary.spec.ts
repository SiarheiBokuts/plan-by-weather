import { buildSummary } from './summary';
import { Activity, Rating, Reason } from './types';

const reason = (text: string, impact: Reason['impact'], weight: number): Reason => ({
  text,
  impact,
  weight,
});

describe('buildSummary', () => {
  it('names the strongest negative reason for a poor day', () => {
    const summary = buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.POOR, [
      reason('Light wind', 'negative', 2),
      reason('Heavy rain (12.0 mm)', 'negative', 66),
      reason('Comfortable temperature (18 °C)', 'positive', 10),
    ]);
    expect(summary).toBe('Heavy rain (12.0 mm): not a day for walking around.');
  });

  it('names the strongest positive reason for a great day', () => {
    const summary = buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.GREAT, [
      reason('Dry', 'positive', 8),
      reason('Comfortable temperature (20 °C)', 'positive', 10),
      reason('Windy (30 km/h)', 'negative', 3),
    ]);
    expect(summary).toBe('Comfortable temperature (20 °C): great for exploring outside.');
  });

  it('uses the fitting verdict for every activity', () => {
    expect(buildSummary(Activity.INDOOR_SIGHTSEEING, Rating.GREAT, [])).toBe(
      'A perfect day for museums and indoor plans.',
    );
    expect(buildSummary(Activity.SKIING, Rating.POOR, [])).toBe('Not a ski day.');
    expect(buildSummary(Activity.SURFING, Rating.FAIR, [])).toBe('Marginal for surfing.');
  });

  it('falls back to the strongest reason of any kind when none matches the rating', () => {
    const summary = buildSummary(Activity.INDOOR_SIGHTSEEING, Rating.GOOD, [
      reason('Mild weather outside', 'neutral', 1),
    ]);
    expect(summary).toBe('Mild weather outside: a good day for museums and indoor plans.');
  });

  it('says "but" when the only factor works against the verdict', () => {
    expect(
      buildSummary(Activity.OUTDOOR_SIGHTSEEING, Rating.GOOD, [
        reason('Light rain (0.8 mm)', 'negative', 8),
      ]),
    ).toBe('Light rain (0.8 mm), but good for exploring outside.');
    expect(
      buildSummary(Activity.SKIING, Rating.FAIR, [reason('Snow depth 20 cm', 'positive', 15)]),
    ).toBe('Snow depth 20 cm, but marginal for skiing.');
  });

  it('still produces a sentence when there are no reasons', () => {
    expect(buildSummary(Activity.SKIING, Rating.GOOD, [])).toBe('Good for skiing.');
  });
});
