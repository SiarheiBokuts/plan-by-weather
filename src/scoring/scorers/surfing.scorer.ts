import { DailyWeatherData, isThunderstorm } from '../../weather/daily-weather';
import { finalScore, lerp, ramp, round } from '../helpers';
import { SCORING } from '../scoring-config';
import { Activity, ActivityScorer, Reason, ScorerOutput } from '../types';

const cfg = SCORING.surfing;

/** Points for wave height: best between roughly 1 and 2.5 m, poor when tiny or huge. */
export function waveHeightPoints(heightM: number): number {
  if (heightM <= cfg.tinyM) return cfg.tinyPoints;
  if (heightM < cfg.smallM) {
    return lerp(
      cfg.tinyPoints,
      cfg.pointsAtSmall,
      (heightM - cfg.tinyM) / (cfg.smallM - cfg.tinyM),
    );
  }
  if (heightM <= cfg.bigM) {
    return lerp(
      cfg.pointsAtSmall,
      cfg.pointsAtIdeal,
      (heightM - cfg.smallM) / (cfg.bigM - cfg.smallM),
    );
  }
  if (heightM <= cfg.hugeM) {
    return lerp(cfg.pointsAtIdeal, cfg.pointsAtBig, (heightM - cfg.bigM) / (cfg.hugeM - cfg.bigM));
  }
  return cfg.pointsTooBig;
}

function waveReason(heightM: number, points: number): Reason {
  const text = (label: string): string => `${label} (${heightM.toFixed(1)} m)`;
  if (heightM < 0.5)
    return { text: text('Very small waves'), impact: 'negative', weight: 100 - points };
  if (heightM < cfg.smallM)
    return { text: text('Small waves'), impact: 'negative', weight: 60 - points };
  if (heightM <= cfg.bigM) return { text: text('Good waves'), impact: 'positive', weight: points };
  if (heightM <= cfg.hugeM) return { text: text('Big waves'), impact: 'neutral', weight: 20 };
  return { text: text('Waves too big'), impact: 'negative', weight: 80 };
}

/** Surfing needs waves; it is unavailable where Open-Meteo has no wave data (inland cities). */
export class SurfingScorer implements ActivityScorer {
  readonly activity = Activity.SURFING;

  score(day: DailyWeatherData): ScorerOutput {
    const height = day.waveHeightMaxM;
    if (height === null) {
      return { available: false, reason: 'No wave data for this location' };
    }

    const heightPoints = waveHeightPoints(height);
    const reasons: Reason[] = [waveReason(height, heightPoints)];
    let score = cfg.base + heightPoints;

    const period = day.wavePeriodMaxS;
    if (period !== null) {
      score += ramp(period, cfg.period.fromS, cfg.period.toS) * cfg.period.maxPoints;
      if (period >= cfg.period.longSwellS) {
        reasons.push({ text: `Long swell (${round(period)} s)`, impact: 'positive', weight: 8 });
      }
    }

    const wind = day.windMaxKmh;
    if (wind !== null && wind > cfg.wind.fromKmh) {
      const penalty = ramp(wind, cfg.wind.fromKmh, cfg.wind.toKmh) * cfg.wind.maxPenalty;
      score -= penalty;
      reasons.push({
        text: `Strong wind (${round(wind)} km/h)`,
        impact: 'negative',
        weight: penalty,
      });
    }

    if (day.tempMaxC !== null && day.tempMaxC < cfg.coldBelowC) {
      score -= cfg.coldPenalty;
      reasons.push({
        text: `Cold air (${round(day.tempMaxC)} °C)`,
        impact: 'negative',
        weight: cfg.coldPenalty,
      });
    }

    if ((day.precipitationMm ?? 0) >= cfg.heavyRainMm) {
      score -= cfg.heavyRainPenalty;
      reasons.push({ text: 'Heavy rain', impact: 'negative', weight: cfg.heavyRainPenalty });
    }

    if (isThunderstorm(day.weatherCode)) {
      score = Math.min(score, cfg.thunderstormCap);
      reasons.push({ text: 'Thunderstorm', impact: 'negative', weight: 60 });
    }

    return { available: true, score: finalScore(score), reasons };
  }
}
