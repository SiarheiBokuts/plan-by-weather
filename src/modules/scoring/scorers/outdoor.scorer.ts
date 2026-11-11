import { DailyWeatherData, isThunderstorm } from '../../../domain/daily-weather';
import { round } from '../engine/helpers';
import { Cap, combine, curveScore, Factor } from '../engine/model';
import { SCORING } from '../config/scoring-config';
import { Activity, ActivityScorer, ScorerOutput } from '../types';

const cfg = SCORING.outdoor;

const missing = (label: string, weight: number): Factor => ({
  label,
  weight,
  score: null,
  good: null,
  bad: null,
});

function precipitation(day: DailyWeatherData): Factor {
  const weight = cfg.weights.precipitation;
  const snow = day.snowfallCm ?? 0;
  if (snow >= 1) {
    // Snowfall is also counted in the precipitation total, so judge snow by its own curve.
    return {
      label: 'Snowfall',
      value: `${round(snow)} cm`,
      weight,
      score: curveScore(cfg.snowCm, snow),
      good: null,
      bad: `Snowfall (${round(snow)} cm)`,
    };
  }
  if (day.precipitationMm === null) return missing('Rain', weight);
  const mm = day.precipitationMm;
  const label = mm < 2.5 ? 'Light rain' : mm < 10 ? 'Rain' : 'Heavy rain';
  return {
    label: 'Rain',
    value: `${mm.toFixed(1)} mm`,
    weight,
    score: curveScore(cfg.rainMm, mm),
    limit: curveScore(cfg.rainLimitMm, mm),
    good: 'Dry',
    bad: `${label} (${mm.toFixed(1)} mm)`,
  };
}

function temperature(day: DailyWeatherData): Factor {
  const weight = cfg.weights.temperature;
  const felt = day.apparentTempMaxC ?? day.tempMaxC;
  if (felt === null) return missing('Temperature', weight);
  const label = felt <= 5 ? 'Cold' : felt < 14 ? 'Cool' : felt <= 30 ? 'Warm' : 'Hot';
  return {
    label: 'Temperature',
    value: `${round(felt)} °C felt`,
    weight,
    score: curveScore(cfg.feltTempC, felt),
    limit: curveScore(cfg.tempLimitC, felt),
    good: `Comfortable temperature (${round(felt)} °C)`,
    bad: `${label} (${round(felt)} °C)`,
  };
}

/** How bright the day is: cloud cover if known, otherwise hours of sunshine. */
function sky(day: DailyWeatherData): Factor {
  const weight = cfg.weights.sky;
  if (day.cloudCoverMeanPct !== null) {
    const cloud = day.cloudCoverMeanPct;
    return {
      label: 'Sky',
      value: `${round(cloud)}% cloud`,
      weight,
      score: curveScore(cfg.cloudPct, cloud),
      good: 'Sunny',
      bad: cloud > 80 ? 'Overcast' : 'Cloudy',
    };
  }
  if (day.sunshineSeconds !== null) {
    const hours = day.sunshineSeconds / 3600;
    return {
      label: 'Sky',
      value: `${hours.toFixed(1)} h of sun`,
      weight,
      score: curveScore(cfg.sunshineHours, hours),
      good: 'Sunny',
      bad: hours < 1 ? 'Overcast' : 'Cloudy',
    };
  }
  return missing('Sky', weight);
}

function wind(day: DailyWeatherData): Factor {
  const weight = cfg.weights.wind;
  if (day.windMaxKmh === null) return missing('Wind', weight);
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

function visibility(day: DailyWeatherData): Factor {
  const weight = cfg.weights.visibility;
  if (day.weatherCode === null) return missing('Visibility', weight);
  const fog = day.weatherCode === 45 || day.weatherCode === 48;
  return {
    label: 'Visibility',
    value: fog ? 'fog' : 'clear',
    weight,
    score: fog ? cfg.fogScore : 100,
    limit: fog ? cfg.fogLimit : undefined,
    good: null,
    bad: 'Fog',
  };
}

/**
 * A good day for walking around town: dry, comfortable, bright, calm, clear. Judged by five
 * factors combined as described in model.ts; a thunderstorm or violent gusts cap the score.
 */
export class OutdoorSightseeingScorer implements ActivityScorer {
  readonly activity = Activity.OUTDOOR_SIGHTSEEING;

  score(day: DailyWeatherData): ScorerOutput {
    if (day.tempMaxC === null && day.apparentTempMaxC === null && day.precipitationMm === null) {
      return { available: false, reason: 'No weather data for this day' };
    }

    const caps: Cap[] = [];
    if (isThunderstorm(day.weatherCode)) {
      caps.push({ max: cfg.caps.thunderstorm, text: 'Thunderstorm' });
    }
    if ((day.gustMaxKmh ?? 0) >= cfg.caps.gustKmh) {
      caps.push({
        max: cfg.caps.gustMax,
        text: `Violent gusts (${round(day.gustMaxKmh ?? 0)} km/h)`,
      });
    }

    const { score, reasons, breakdown } = combine(
      [precipitation(day), temperature(day), sky(day), wind(day), visibility(day)],
      caps,
    );
    return { available: true, score, reasons, breakdown };
  }
}
