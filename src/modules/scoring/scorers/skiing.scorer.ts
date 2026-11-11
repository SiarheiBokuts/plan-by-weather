import { DailyWeatherData } from '../../../domain/daily-weather';
import { round } from '../engine/helpers';
import { Cap, combine, curveScore, Factor } from '../engine/model';
import { SCORING } from '../config/scoring-config';
import { Activity, ActivityScorer, ScorerOutput } from '../types';

const cfg = SCORING.skiing;

const isFog = (code: number): boolean => code === 45 || code === 48;

/**
 * Skiing needs snow first (on the ground, and ideally fresh); cold and calm, clear weather then
 * keep it good. With no snow at all the score is capped very low and says so.
 */
export class SkiingScorer implements ActivityScorer {
  readonly activity = Activity.SKIING;

  score(day: DailyWeatherData): ScorerOutput {
    if (day.snowDepthCm === null && day.snowfallCm === null) {
      return { available: false, reason: 'No snow data for this location' };
    }
    const depth = day.snowDepthCm ?? 0;
    const fresh = day.snowfallCm ?? 0;
    // New snow lies on the ground too (the depth is unknown when only snowfall is reported).
    const base = Math.max(depth, fresh);
    const w = cfg.weights;

    const factors: Factor[] = [
      {
        label: 'Snow on the ground',
        value: `${round(depth)} cm`,
        weight: w.snowDepth,
        score: curveScore(cfg.snowDepthCm, base),
        limit: curveScore(cfg.depthLimitCm, base),
        good: `Snow depth ${round(depth)} cm`,
        bad: null,
      },
      {
        label: 'New snow',
        value: `${round(fresh)} cm`,
        weight: w.freshSnow,
        score: curveScore(cfg.freshSnowCm, fresh),
        good: fresh >= cfg.caps.minFreshCm ? `Fresh snow (${round(fresh)} cm)` : null,
        bad: null,
      },
      this.temperature(day),
      this.wind(day),
      {
        label: 'Visibility',
        value: day.weatherCode === null ? undefined : isFog(day.weatherCode) ? 'fog' : 'clear',
        weight: w.visibility,
        score: day.weatherCode === null ? null : isFog(day.weatherCode) ? cfg.fogScore : 100,
        good: null,
        bad: 'Fog',
      },
    ];

    const caps: Cap[] = [];
    if (depth < cfg.caps.minDepthCm && fresh < cfg.caps.minFreshCm) {
      caps.push({ max: cfg.caps.noSnow, text: 'No snow on the ground' });
    }
    const ros = cfg.caps.rainOnSnow;
    const rain = day.precipitationMm ?? 0;
    if (
      rain >= ros.minMm &&
      fresh < rain * ros.freshShareBelow &&
      (day.tempMaxC ?? 0) > ros.aboveC
    ) {
      caps.push({ max: ros.max, text: 'Rain on snow' });
    }

    const { score, reasons, breakdown } = combine(factors, caps);
    return { available: true, score, reasons, breakdown };
  }

  private temperature(day: DailyWeatherData): Factor {
    const weight = cfg.weights.temperature;
    const t = day.tempMaxC;
    if (t === null) return { label: 'Temperature', weight, score: null, good: null, bad: null };
    return {
      label: 'Temperature',
      value: `${round(t)} °C at most`,
      weight,
      score: curveScore(cfg.tempMaxC, t),
      limit: curveScore(cfg.tempLimitC, t),
      good: null,
      bad: t > 2 ? `Warm (${round(t)} °C), snow may be soft` : `Very cold (${round(t)} °C)`,
    };
  }

  private wind(day: DailyWeatherData): Factor {
    const weight = cfg.weights.wind;
    if (day.windMaxKmh === null)
      return { label: 'Wind', weight, score: null, good: null, bad: null };
    return {
      label: 'Wind',
      value: `${round(day.windMaxKmh)} km/h`,
      weight,
      score: curveScore(cfg.windKmh, day.windMaxKmh),
      limit: curveScore(cfg.windLimitKmh, day.windMaxKmh),
      good: null,
      bad: `Windy (${round(day.windMaxKmh)} km/h)`,
    };
  }
}
