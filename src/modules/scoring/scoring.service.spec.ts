import { dayOf } from '../../../test/support/builders';
import { ScoringService } from './scoring.service';
import { Activity, Rating } from './types';

const service = new ScoringService();

/** Three days: dry and mild, then heavy rain, then dry again. Waves only on the first two. */
const week = [
  dayOf({ date: '2026-11-10', waveHeightMaxM: 1.8, wavePeriodMaxS: 11 }),
  dayOf({
    date: '2026-11-11',
    precipitationMm: 12,
    apparentTempMaxC: 8,
    tempMaxC: 9,
    waveHeightMaxM: 0.4,
    wavePeriodMaxS: 5,
  }),
  dayOf({ date: '2026-11-12' }),
];

describe('ScoringService', () => {
  describe('buildOutlook', () => {
    const outlook = service.buildOutlook(week);

    it('returns one outlook per activity with a score for every day', () => {
      expect(outlook.byActivity).toHaveLength(4);
      for (const activity of outlook.byActivity) expect(activity.days).toHaveLength(3);
      expect(outlook.byDay).toHaveLength(3);
    });

    it('orders activities by their weekly score, best first', () => {
      const scores = outlook.byActivity.map((a) => a.score ?? -1);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('averages the available days for the weekly score and rating', () => {
      const outdoor = outlook.byActivity.find((a) => a.activity === Activity.OUTDOOR_SIGHTSEEING)!;
      const days = outdoor.days.map((d) => d.score as number);
      expect(outdoor.score).toBe(Math.round(days.reduce((a, b) => a + b, 0) / days.length));
      expect(outdoor.rating).not.toBeNull();
    });

    it('reports the best day and ranks days within an activity', () => {
      const outdoor = outlook.byActivity.find((a) => a.activity === Activity.OUTDOOR_SIGHTSEEING)!;
      expect(outdoor.bestDay).toBe('2026-11-10');
      expect(outdoor.days.map((d) => d.rank)).toEqual([1, 3, 2]);
    });

    it('breaks equal scores in favour of the earlier date', () => {
      const outdoor = outlook.byActivity.find((a) => a.activity === Activity.OUTDOOR_SIGHTSEEING)!;
      const first = outdoor.days.find((d) => d.date === '2026-11-10')!;
      const third = outdoor.days.find((d) => d.date === '2026-11-12')!;
      expect(first.score).toBe(third.score);
      expect(first.rank).toBe(1);
      expect(third.rank).toBe(2);
    });

    it('ranks the rainy day best for indoor sightseeing', () => {
      const indoor = outlook.byActivity.find((a) => a.activity === Activity.INDOOR_SIGHTSEEING)!;
      expect(indoor.bestDay).toBe('2026-11-11');
    });

    it('marks surfing unavailable on days without waves but keeps the activity available', () => {
      const surfing = outlook.byActivity.find((a) => a.activity === Activity.SURFING)!;
      expect(surfing.available).toBe(true);
      const dayWithoutWaves = surfing.days[2];
      expect(dayWithoutWaves.available).toBe(false);
      expect(dayWithoutWaves.rank).toBeNull();
      expect(dayWithoutWaves.summary).toBe('No wave data for this location.');
    });

    it('lists, for each day, activities best first and names the best activity', () => {
      const rainyDay = outlook.byDay[1];
      expect(rainyDay.bestActivity).toBe(Activity.INDOOR_SIGHTSEEING);
      const scores = rainyDay.activities.map((a) => a.score ?? -1);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(rainyDay.weather).toBe(week[1]);
    });

    it('puts unavailable activities last within a day', () => {
      const lastDay = outlook.byDay[2];
      expect(lastDay.activities[lastDay.activities.length - 1].available).toBe(false);
    });
  });

  describe('an activity that is never available', () => {
    const inland = service.buildOutlook([
      dayOf({ date: '2026-11-10' }),
      dayOf({ date: '2026-11-11' }),
    ]);
    const surfing = inland.byActivity.find((a) => a.activity === Activity.SURFING)!;

    it('has no score, rating or best day, and says why', () => {
      expect(surfing).toMatchObject({
        available: false,
        unavailableReason: 'No wave data for this location',
        score: null,
        rating: null,
        bestDay: null,
      });
    });

    it('is listed after the available activities', () => {
      expect(inland.byActivity[inland.byActivity.length - 1].activity).toBe(Activity.SURFING);
    });

    it('does not stop the other activities from being scored', () => {
      expect(inland.byActivity.filter((a) => a.available)).toHaveLength(3);
    });
  });

  it('breaks equal weekly scores by the fixed activity order', () => {
    const outlook = service.buildOutlook([
      dayOf({ waveHeightMaxM: null, snowDepthCm: null, snowfallCm: null }),
    ]);
    const unavailable = outlook.byActivity.filter((a) => !a.available);
    expect(unavailable.map((a) => a.activity)).toEqual([Activity.SKIING, Activity.SURFING]);
  });

  it('handles an empty week without mixing activities up', () => {
    const outlook = service.buildOutlook([]);
    expect(outlook.byDay).toEqual([]);
    expect(outlook.byActivity.map((a) => a.activity).sort()).toEqual(
      [
        Activity.INDOOR_SIGHTSEEING,
        Activity.OUTDOOR_SIGHTSEEING,
        Activity.SKIING,
        Activity.SURFING,
      ].sort(),
    );
    expect(outlook.byActivity.every((a) => !a.available)).toBe(true);
    expect(outlook.byActivity.every((a) => a.unavailableReason === 'No data')).toBe(true);
  });

  describe('scoreDay', () => {
    it('describes an unavailable day with a sentence', () => {
      const scorer = {
        activity: Activity.SURFING,
        score: () => ({ available: false as const, reason: 'No waves' }),
      };
      expect(service.scoreDay(scorer, dayOf())).toMatchObject({
        available: false,
        score: null,
        rating: null,
        summary: 'No waves.',
        unavailableReason: 'No waves',
      });
    });

    it('attaches a rating, summary and the reasons as plain text', () => {
      const scorer = {
        activity: Activity.OUTDOOR_SIGHTSEEING,
        score: () => ({
          available: true as const,
          score: 90,
          reasons: [{ text: 'Dry', impact: 'positive' as const, weight: 8 }],
          breakdown: { factors: [], points: 90, limitedBy: null },
        }),
      };
      expect(service.scoreDay(scorer, dayOf())).toMatchObject({
        available: true,
        score: 90,
        rating: Rating.GREAT,
        summary: 'Dry: great for exploring outside.',
        reasons: ['Dry'],
        breakdown: { factors: [], points: 90, limitedBy: null },
        unavailableReason: null,
      });
    });
  });
});
