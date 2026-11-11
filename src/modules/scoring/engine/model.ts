import { finalScore } from './helpers';
import { Reason } from '../types';

/**
 * THE SCORING MODEL: points for good things, ceilings for bad ones (the numbers are in scoring-config.ts).
 *
 * Each factor (rain, temperature, wind...) turns a measurement into a 0-100 mark with a CURVE.
 * Marks times weights are added up (POINTS), then a factor's CEILING or a dealbreaker CAP can only
 * lower the result. A weighted average alone would hide disasters (a downpour is one factor of
 * five); and "start at 100 and subtract" would make every dry day score about 100, so earning
 * points from zero keeps a merely acceptable day around 60-70. See `combine` for the formula.
 */

/** A curve is a list of [value, score] points; scores between points are interpolated in a straight line. */
export type Curve = ReadonlyArray<readonly [number, number]>;

/** Score of a measured value: straight lines between the curve's points, flat outside them. */
export function curveScore(curve: Curve, value: number): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  // The value lies strictly inside the curve: find the segment it falls in and draw a straight line.
  const i = curve.findIndex(([x]) => value <= x);
  const [x0, y0] = curve[i - 1];
  const [x1, y1] = curve[i];
  return y0 + ((y1 - y0) * (value - x0)) / (x1 - x0);
}

export interface Factor {
  /** Short name shown in the breakdown, e.g. "Rain" */
  label: string;
  /** The measurement in words, e.g. "0.8 mm" (omit when the data is missing) */
  value?: string;
  /** Importance relative to the other factors of the same activity */
  weight: number;
  /** 0-100, or null when the data is missing (the factor is then left out) */
  score: number | null;
  /** What to say when this factor is a clear plus for the day (null: say nothing) */
  good: string | null;
  /** What to say when this factor is a clear problem (null: say nothing) */
  bad: string | null;
  /** Ceiling for the final score caused by this factor (100 or missing: no ceiling) */
  limit?: number;
}

/** A dealbreaker: while it applies, the score cannot be higher than `max`. */
export interface Cap {
  max: number;
  text: string;
}

/** A factor is mentioned as a good thing from this score up, and as a bad thing from this score down. */
export const REPORT_GOOD_FROM = 90;
export const REPORT_BAD_UNTIL = 65;
/** A factor whose limit is this low or lower is reported as a problem even if its own score is mild. */
const REPORT_LIMIT_UNTIL = 75;
/** A factor's pull on the headline sentence is its weight times its distance from this "so-so" score. */
const NEUTRAL_SCORE = 75;

/** One line of the explanation of a score: what was measured and how many points it earned. */
export interface FactorBreakdown {
  label: string;
  value: string | null;
  /** 0-100 mark from the curve; null for a line that is not a measured condition */
  mark: number | null;
  /** This condition's share of the 100 points, in percent; null for a line that is not a condition */
  weight: number | null;
  /** Points earned (negative for a deduction) */
  points: number;
  /** The ceiling this condition sets for the whole score, when it sets one */
  limit: number | null;
}

/** Everything behind a score, so that it can be explained instead of only stated. */
export interface Breakdown {
  factors: FactorBreakdown[];
  /** The points added up, before ceilings */
  points: number;
  /** What lowered the score below the points (the lowest ceiling or cap), or null when nothing did */
  limitedBy: string | null;
}

export interface Combined {
  score: number;
  reasons: Reason[];
  breakdown: Breakdown;
}

/**
 * THE FINAL MATHS. Every score in the service comes out of this function.
 *
 *   score = min( points , lowest ceiling of any factor , lowest cap )     then rounded to a whole number
 *
 *   points = ( weight1 x mark1  +  weight2 x mark2  +  ...  )  /  ( weight1 + weight2 + ... )
 *
 * where "mark" is the 0-100 result of the factor's curve (curveScore above) and only factors whose
 * measurement exists take part. Because the weights of an activity add up to 100, this is simply the
 * sum of "weight% of the mark" for each factor. Example (grey dry day, outdoor sightseeing):
 *   30% x 100 (rain) + 35% x 73.5 (temperature) + 15% x 25 (sky) + 10% x 100 (wind) + 10% x 100 (fog)
 *   = 30 + 25.7 + 3.8 + 10 + 10 = 79.5   -> no ceiling is lower -> 79
 */
export function combine(factors: Factor[], caps: Cap[] = []): Combined {
  // Step 1: leave out the factors whose measurement is missing.
  const known = factors.filter(
    (factor): factor is Factor & { score: number } => factor.score !== null,
  );
  const totalWeight = known.reduce((sum, factor) => sum + factor.weight, 0);

  // Step 2: add up the points (weight x mark), divided by the total weight so that a day with
  // every factor ideal gives exactly 100 even when some factors are missing.
  const points = known.reduce((sum, factor) => sum + factor.weight * factor.score, 0);
  let score = totalWeight > 0 ? points / totalWeight : 0;

  const pointsBeforeCeilings = score;
  let limitedBy: { max: number; text: string } | null = null;
  const lower = (max: number, text: string, isCap = false): void => {
    if (max >= pointsBeforeCeilings) return;
    // The lowest ceiling is the one to name; on a tie a dealbreaker is clearer than a condition.
    if (limitedBy === null || max < limitedBy.max || (isCap && max === limitedBy.max)) {
      limitedBy = { max, text };
    }
  };

  // Step 3: ceilings. A factor can forbid a score higher than its own limit (heavy rain, wind...).
  for (const factor of known) {
    if (factor.limit !== undefined) {
      score = Math.min(score, factor.limit);
      lower(factor.limit, `${factor.label} limits the day`);
    }
  }

  // Step 4: caps. Fixed ceilings for dealbreakers (thunderstorm, no snow).
  for (const cap of caps) {
    score = Math.min(score, cap.max);
    lower(cap.max, cap.text, true);
  }

  // Step 5 (below): the "reasons" shown to the user come from the same factors; the strongest
  // one becomes the headline of the one-sentence summary.

  const reasons: Reason[] = [];
  for (const factor of known) {
    const bad =
      factor.score <= REPORT_BAD_UNTIL ||
      (factor.limit !== undefined && factor.limit <= REPORT_LIMIT_UNTIL);
    const good = !bad && factor.score >= REPORT_GOOD_FROM;
    const text = bad ? factor.bad : good ? factor.good : null;
    if (text === null) continue;
    reasons.push({
      text,
      impact: bad ? 'negative' : 'positive',
      weight: factor.weight * Math.abs(Math.min(factor.score, factor.limit ?? 100) - NEUTRAL_SCORE),
    });
  }
  for (const cap of caps) {
    reasons.push({ text: cap.text, impact: 'negative', weight: 1_000_000 });
  }

  const one = (n: number): number => Math.round(n * 10) / 10;
  const lines: FactorBreakdown[] = factors.map((factor) => ({
    label: factor.label,
    value: factor.value ?? null,
    mark: factor.score === null ? null : one(factor.score),
    weight:
      factor.score === null || totalWeight === 0 ? null : one((factor.weight / totalWeight) * 100),
    points:
      factor.score === null || totalWeight === 0
        ? 0
        : one((factor.weight * factor.score) / totalWeight),
    limit: factor.limit === undefined || factor.limit >= 100 ? null : one(factor.limit),
  }));
  const limit = limitedBy as { max: number; text: string } | null;
  return {
    score: finalScore(score),
    reasons,
    breakdown: {
      factors: lines,
      points: one(pointsBeforeCeilings),
      limitedBy: limit ? `${limit.text}: at most ${Math.round(limit.max)}` : null,
    },
  };
}
