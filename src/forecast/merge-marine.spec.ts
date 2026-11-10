import { dayOf } from '../../test/support/builders';
import { mergeMarine } from './forecast.service';

describe('mergeMarine', () => {
  const days = [dayOf({ date: '2026-11-10' }), dayOf({ date: '2026-11-11' })];

  it('returns the days untouched when there is no wave data', () => {
    expect(mergeMarine(days, null)).toBe(days);
  });

  it('adds wave height and period to the matching dates', () => {
    const merged = mergeMarine(days, [
      { date: '2026-11-11', waveHeightMaxM: 1.5, wavePeriodMaxS: 9 },
    ]);
    expect(merged[0].waveHeightMaxM).toBeNull();
    expect(merged[1]).toMatchObject({ waveHeightMaxM: 1.5, wavePeriodMaxS: 9 });
  });
});
