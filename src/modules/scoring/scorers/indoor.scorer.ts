import { DailyWeatherData, isThunderstorm } from '../../../domain/daily-weather';
import { finalScore } from '../engine/helpers';
import { SCORING } from '../config/scoring-config';
import { Activity, ActivityScorer, Reason, ScorerOutput } from '../types';
import { OutdoorSightseeingScorer } from './outdoor.scorer';

const cfg = SCORING.indoor;

/**
 * Indoor sights are always an option (base score), and get better the worse it is outside.
 * Only genuinely dangerous weather lowers the score, because getting there becomes hard.
 */
export class IndoorSightseeingScorer implements ActivityScorer {
  readonly activity = Activity.INDOOR_SIGHTSEEING;

  constructor(private readonly outdoor = new OutdoorSightseeingScorer()) {}

  score(day: DailyWeatherData): ScorerOutput {
    const outside = this.outdoor.score(day);
    if (!outside.available) return outside;

    const bonus = (100 - outside.score) * cfg.bonusFactor;
    let score = cfg.base + bonus;

    // The reasons that make outdoor plans bad are the reasons indoor plans are good.
    const reasons: Reason[] = outside.reasons
      .filter((reason) => reason.impact === 'negative')
      .map((reason) => ({ ...reason, impact: 'positive' as const }));

    const severe =
      isThunderstorm(day.weatherCode) ||
      (day.gustMaxKmh ?? 0) >= cfg.severe.gustKmh ||
      (day.snowfallCm ?? 0) >= cfg.severe.snowfallCm;
    const penalty = severe ? cfg.severe.penalty : 0;
    if (severe) {
      score -= cfg.severe.penalty;
      reasons.push({ text: 'Severe weather, travel may be risky', impact: 'negative', weight: 50 });
    }

    if (reasons.length === 0) {
      reasons.push({ text: 'Mild weather outside', impact: 'neutral', weight: 1 });
    }
    const one = (n: number): number => Math.round(n * 10) / 10;
    const line = (label: string, value: string | null, points: number) => ({
      label,
      value,
      mark: null,
      weight: null,
      points: one(points),
      limit: null,
    });
    // Indoor sightseeing is not measured on its own: it starts from a fair baseline and gains what
    // the outdoor day loses, so the explanation is a short sum instead of weighted conditions.
    const breakdown = {
      factors: [
        line('Always an option', null, cfg.base),
        line('Bad weather outside', `outdoor scores ${outside.score}`, bonus),
        ...(severe ? [line('Dangerous to travel', null, -penalty)] : []),
      ],
      points: one(score),
      limitedBy: null,
    };
    return { available: true, score: finalScore(score), reasons, breakdown };
  }
}
