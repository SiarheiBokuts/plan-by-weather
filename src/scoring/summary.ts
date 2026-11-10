import { VERDICTS } from './scoring-config';
import { Activity, Rating, Reason } from './types';

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * One plain sentence: the strongest reason in the direction of the rating, then a verdict.
 * Examples: "Rain (12.0 mm): not a day for walking around."
 * and, when the main factor works against the verdict: "Light rain (0.8 mm), but good for exploring outside."
 */
export function buildSummary(activity: Activity, rating: Rating, reasons: Reason[]): string {
  const bad = rating === Rating.POOR || rating === Rating.FAIR;
  const wanted = bad ? 'negative' : 'positive';
  const strongest = (list: Reason[]): Reason | undefined =>
    list.reduce<Reason | undefined>(
      (best, reason) => (best === undefined || reason.weight > best.weight ? reason : best),
      undefined,
    );

  const headline =
    strongest(reasons.filter((reason) => reason.impact === wanted)) ?? strongest(reasons);
  const verdict = VERDICTS[activity][rating];
  if (!headline) return `${capitalize(verdict)}.`;
  // The headline points the opposite way from the verdict ("Light rain" on a GOOD day): say "but"
  // instead of a colon so the sentence does not contradict itself.
  const opposite = headline.impact !== 'neutral' && headline.impact !== wanted;
  return opposite ? `${headline.text}, but ${verdict}.` : `${headline.text}: ${verdict}.`;
}
