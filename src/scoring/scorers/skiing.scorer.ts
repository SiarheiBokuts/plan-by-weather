import { DailyWeatherData } from '../../weather/daily-weather';
import { finalScore, ramp, round } from '../helpers';
import { SCORING } from '../scoring-config';
import { Activity, ActivityScorer, Reason, ScorerOutput } from '../types';

const cfg = SCORING.skiing;

/**
 * Skiing needs snow first (depth on the ground, fresh snowfall); cold and calm weather then
 * keep it good. Without snow the day is scored very low and says so.
 */
export class SkiingScorer implements ActivityScorer {
  readonly activity = Activity.SKIING;

  score(day: DailyWeatherData): ScorerOutput {
    if (day.snowDepthCm === null && day.snowfallCm === null) {
      return { available: false, reason: 'No snow data for this location' };
    }
    const depth = day.snowDepthCm ?? 0;
    const fresh = day.snowfallCm ?? 0;

    if (depth < cfg.minDepthCm && fresh < cfg.minFreshCm) {
      return {
        available: true,
        score: cfg.noSnowScore,
        reasons: [{ text: 'No snow on the ground', impact: 'negative', weight: 100 }],
      };
    }

    const reasons: Reason[] = [];
    let score = cfg.base;

    const depthPoints = ramp(depth, 0, cfg.fullDepthCm) * cfg.depthMaxPoints;
    score += depthPoints;
    if (depth >= cfg.minDepthCm) {
      reasons.push({
        text: `Snow depth ${round(depth)} cm`,
        impact: 'positive',
        weight: depthPoints,
      });
    }

    const freshPoints = ramp(fresh, 0, cfg.fullFreshCm) * cfg.freshMaxPoints;
    score += freshPoints;
    if (fresh >= cfg.minFreshCm) {
      reasons.push({
        text: `Fresh snow (${round(fresh)} cm)`,
        impact: 'positive',
        weight: freshPoints,
      });
    }

    const warmest = day.tempMaxC;
    if (warmest !== null) {
      if (warmest > cfg.warmAboveC) {
        const penalty = Math.min(
          (warmest - cfg.warmAboveC) * cfg.warmPenaltyPerDegree,
          cfg.warmMaxPenalty,
        );
        score -= penalty;
        reasons.push({
          text: `Warm (${round(warmest)} °C), snow may be soft`,
          impact: 'negative',
          weight: penalty,
        });
      } else if (warmest < cfg.veryColdBelowC) {
        score -= cfg.veryColdPenalty;
        reasons.push({
          text: `Very cold (${round(warmest)} °C)`,
          impact: 'negative',
          weight: cfg.veryColdPenalty,
        });
      }
    }

    const wind = day.windMaxKmh;
    if (wind !== null && wind > cfg.wind.fromKmh) {
      const penalty = ramp(wind, cfg.wind.fromKmh, cfg.wind.toKmh) * cfg.wind.maxPenalty;
      score -= penalty;
      reasons.push({ text: `Windy (${round(wind)} km/h)`, impact: 'negative', weight: penalty });
    }

    const rain = day.precipitationMm ?? 0;
    const ros = cfg.rainOnSnow;
    if (rain >= ros.minMm && fresh < rain * ros.freshShareBelow && (warmest ?? 0) > ros.aboveC) {
      score -= ros.penalty;
      reasons.push({ text: 'Rain on snow', impact: 'negative', weight: ros.penalty });
    }

    return { available: true, score: finalScore(score), reasons };
  }
}
