import { DailyWeatherData, isThunderstorm } from '../../weather/daily-weather';
import { finalScore } from '../helpers';
import { SCORING } from '../scoring-config';
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

    let score = cfg.base + (100 - outside.score) * cfg.bonusFactor;

    // The reasons that make outdoor plans bad are the reasons indoor plans are good.
    const reasons: Reason[] = outside.reasons
      .filter((reason) => reason.impact === 'negative')
      .map((reason) => ({ ...reason, impact: 'positive' as const }));

    const severe =
      isThunderstorm(day.weatherCode) ||
      (day.gustMaxKmh ?? 0) >= cfg.severe.gustKmh ||
      (day.snowfallCm ?? 0) >= cfg.severe.snowfallCm;
    if (severe) {
      score -= cfg.severe.penalty;
      reasons.push({ text: 'Severe weather, travel may be risky', impact: 'negative', weight: 50 });
    }

    if (reasons.length === 0) {
      reasons.push({ text: 'Mild weather outside', impact: 'neutral', weight: 1 });
    }
    return { available: true, score: finalScore(score), reasons };
  }
}
