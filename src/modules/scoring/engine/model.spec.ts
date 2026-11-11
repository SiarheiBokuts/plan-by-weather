import { combine, curveScore, Curve, Factor } from './model';

const factor = (weight: number, score: number | null, text: string | null = null): Factor => ({
  label: 'Condition',
  weight,
  score,
  good: text,
  bad: text,
});

describe('curveScore', () => {
  const curve: Curve = [
    [0, 0],
    [10, 100],
    [20, 100],
    [30, 40],
  ];

  it('joins the points with straight lines', () => {
    expect(curveScore(curve, 5)).toBe(50);
    expect(curveScore(curve, 10)).toBe(100);
    expect(curveScore(curve, 25)).toBe(70);
  });

  it('stays flat outside the first and last point', () => {
    expect(curveScore(curve, -50)).toBe(0);
    expect(curveScore(curve, 99)).toBe(40);
  });

  it('works with a curve of one point', () => {
    expect(curveScore([[5, 70]], 1)).toBe(70);
    expect(curveScore([[5, 70]], 9)).toBe(70);
  });
});

describe('combine', () => {
  it('gives 100 when every factor is perfect', () => {
    expect(combine([factor(1, 100), factor(3, 100)]).score).toBe(100);
  });

  it('adds up the points: a weighted average of the factor scores', () => {
    expect(combine([factor(1, 100), factor(1, 50)]).score).toBe(75);
    expect(combine([factor(3, 100), factor(1, 0)]).score).toBe(75);
  });

  it('counts a heavier factor for more', () => {
    const heavyBad = combine([factor(5, 30), factor(1, 100)]).score;
    const lightBad = combine([factor(1, 30), factor(5, 100)]).score;
    expect(heavyBad).toBeLessThan(lightBad);
  });

  it('leaves out factors without data and does not penalise their absence', () => {
    expect(combine([factor(1, 80), factor(9, null)]).score).toBe(80);
  });

  it('is 0 when there is nothing to judge', () => {
    expect(combine([]).score).toBe(0);
    expect(combine([factor(1, null)]).score).toBe(0);
  });

  describe('ceilings and caps', () => {
    it('limits the score to the ceiling of a factor, so one disaster is not averaged away', () => {
      const downpour: Factor = {
        label: 'Rain',
        weight: 1,
        score: 5,
        good: null,
        bad: null,
        limit: 20,
      };
      const plain = combine([factor(1, 5), factor(4, 100)]).score; // averaged: looks decent
      expect(plain).toBeGreaterThan(75);
      expect(combine([downpour, factor(4, 100)]).score).toBe(20);
    });

    it('ignores a ceiling that is higher than the score', () => {
      const withLimit: Factor = {
        label: 'Rain',
        weight: 1,
        score: 90,
        good: null,
        bad: null,
        limit: 100,
      };
      expect(combine([withLimit]).score).toBe(90);
    });

    it('applies the lowest cap and reports every cap as the biggest problem', () => {
      const result = combine(
        [factor(1, 100)],
        [
          { max: 60, text: 'Gusts' },
          { max: 20, text: 'Thunderstorm' },
        ],
      );
      expect(result.score).toBe(20);
      expect(result.reasons.map((r) => r.text)).toEqual(['Gusts', 'Thunderstorm']);
      expect(result.reasons.every((r) => r.impact === 'negative' && r.weight >= 1_000_000)).toBe(
        true,
      );
    });
  });

  describe('reasons', () => {
    it('mentions a factor that is clearly good or clearly bad, and skips ordinary ones', () => {
      const { reasons } = combine([
        factor(1, 95, 'Dry'),
        factor(1, 40, 'Cold'),
        factor(1, 80, 'Fine wind'),
      ]);
      expect(reasons).toEqual([
        expect.objectContaining({ text: 'Dry', impact: 'positive' }),
        expect.objectContaining({ text: 'Cold', impact: 'negative' }),
      ]);
    });

    it('says nothing about a factor without a text', () => {
      expect(combine([factor(1, 100, null)]).reasons).toEqual([]);
    });

    it('reports a factor as a problem when its ceiling bites even if its own score is mild', () => {
      const windy: Factor = {
        label: 'Wind',
        weight: 1,
        score: 80,
        good: null,
        bad: 'Windy',
        limit: 50,
      };
      expect(combine([windy]).reasons).toEqual([
        expect.objectContaining({ text: 'Windy', impact: 'negative' }),
      ]);
    });

    it('gives a bigger pull to a heavier and more extreme factor', () => {
      const { reasons } = combine([factor(1, 55, 'Mild problem'), factor(3, 10, 'Big problem')]);
      const weightOf = (text: string): number => reasons.find((r) => r.text === text)!.weight;
      expect(weightOf('Big problem')).toBeGreaterThan(weightOf('Mild problem'));
    });
  });
});
