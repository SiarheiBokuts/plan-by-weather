import { DailyWeatherData, isThunderstorm } from '../../weather/daily-weather';
import { finalScore, ramp, round } from '../helpers';
import { SCORING } from '../scoring-config';
import { ActivityScorer, Activity, Reason, ScorerOutput } from '../types';

const cfg = SCORING.outdoor;

/** Good outdoor day: dry, comfortable temperature, little wind, no thunderstorm. */
export class OutdoorSightseeingScorer implements ActivityScorer {
  readonly activity = Activity.OUTDOOR_SIGHTSEEING;

  score(day: DailyWeatherData): ScorerOutput {
    if (day.tempMaxC === null && day.apparentTempMaxC === null && day.precipitationMm === null) {
      return { available: false, reason: 'No weather data for this day' };
    }

    let score = 100;
    const reasons: Reason[] = [];
    const snowfall = day.snowfallCm ?? 0;
    const rain = day.precipitationMm ?? 0;

    if (snowfall >= cfg.snow.noticeCm) {
      const penalty = ramp(snowfall, cfg.snow.noticeCm, cfg.snow.heavyCm) * cfg.snow.maxPenalty;
      score -= penalty;
      reasons.push({
        text: `Snowfall (${round(snowfall)} cm)`,
        impact: 'negative',
        weight: penalty + 1,
      });
    } else if (rain >= cfg.rain.noticeMm) {
      const penalty =
        cfg.rain.basePenalty +
        ramp(rain, cfg.rain.noticeMm, cfg.rain.heavyMm) *
          (cfg.rain.maxPenalty - cfg.rain.basePenalty);
      score -= penalty;
      const label =
        rain < cfg.rain.lightMm ? 'Light rain' : rain < cfg.rain.heavyMm ? 'Rain' : 'Heavy rain';
      reasons.push({
        text: `${label} (${rain.toFixed(1)} mm)`,
        impact: 'negative',
        weight: penalty + 1,
      });
    } else if (day.precipitationMm !== null) {
      reasons.push({ text: 'Dry', impact: 'positive', weight: 8 });
    }

    const feelsLike = day.apparentTempMaxC ?? day.tempMaxC;
    if (feelsLike !== null) {
      if (feelsLike < cfg.idealTempC.min) {
        const penalty = Math.min(
          (cfg.idealTempC.min - feelsLike) * cfg.coldPenaltyPerDegree,
          cfg.coldMaxPenalty,
        );
        score -= penalty;
        reasons.push({
          text: `Cold (${round(feelsLike)} °C)`,
          impact: 'negative',
          weight: penalty,
        });
      } else if (feelsLike > cfg.idealTempC.max) {
        const penalty = Math.min(
          (feelsLike - cfg.idealTempC.max) * cfg.heatPenaltyPerDegree,
          cfg.heatMaxPenalty,
        );
        score -= penalty;
        reasons.push({ text: `Hot (${round(feelsLike)} °C)`, impact: 'negative', weight: penalty });
      } else {
        reasons.push({
          text: `Comfortable temperature (${round(feelsLike)} °C)`,
          impact: 'positive',
          weight: 10,
        });
      }
    }

    const wind = day.windMaxKmh;
    if (wind !== null && wind > cfg.wind.comfortableKmh) {
      const penalty =
        ramp(wind, cfg.wind.comfortableKmh, cfg.wind.extremeKmh) * cfg.wind.maxPenalty;
      score -= penalty;
      reasons.push({ text: `Windy (${round(wind)} km/h)`, impact: 'negative', weight: penalty });
    }

    if (isThunderstorm(day.weatherCode)) {
      score = Math.min(score, cfg.thunderstormCap);
      reasons.push({ text: 'Thunderstorm', impact: 'negative', weight: 60 });
    }

    const sunHours = (day.sunshineSeconds ?? 0) / 3600;
    if (sunHours >= cfg.sunnyHours && rain < cfg.rain.noticeMm) {
      reasons.push({ text: `Sunny (${round(sunHours)} h of sun)`, impact: 'positive', weight: 6 });
    }

    return { available: true, score: finalScore(score), reasons };
  }
}
