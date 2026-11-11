import { VERDICTS } from '../config/scoring-config';
import { Activity, Rating, Reason } from '../types';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * One plain sentence, built from rules (not by an LLM, so it is instant, free and testable):
 * the factor that mattered most, then a verdict for the rating.
 *   "Rain (12.0 mm): not a day for walking around."
 * When the main factor points against the verdict, the two are joined with "but" so the sentence
 * does not contradict itself:
 *   "Overcast, but good for exploring outside."
 */
export function buildSummary(activity: Activity, rating: Rating, reasons: Reason[]): string {
  const verdict = VERDICTS[activity][rating];
  const strongest = reasons.reduce<Reason | undefined>(
    (best, reason) => (best === undefined || reason.weight > best.weight ? reason : best),
    undefined,
  );
  if (!strongest) return `${capitalize(verdict)}.`;

  const goodDay = rating === Rating.GOOD || rating === Rating.GREAT;
  const against = strongest.impact !== 'neutral' && (strongest.impact === 'positive') !== goodDay;
  return against ? `${strongest.text}, but ${verdict}.` : `${strongest.text}: ${verdict}.`;
}
