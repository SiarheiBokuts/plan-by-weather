import { DailyWeatherData, isThunderstorm } from '../../../domain/daily-weather';
import { round } from '../engine/helpers';
import { Cap, combine, curveScore, Factor } from '../engine/model';
import { SCORING } from '../config/scoring-config';
import { Activity, ActivityScorer, ScorerOutput } from '../types';

const cfg = SCORING.surfing;

function waves(heightM: number): Factor {
  const label = (text: string): string => `${text} (${heightM.toFixed(1)} m)`;
  return {
    label: 'Wave height',
    value: `${heightM.toFixed(1)} m`,
    weight: cfg.weights.waveHeight,
    score: curveScore(cfg.waveM, heightM),
    limit: curveScore(cfg.waveLimitM, heightM),
    good: label('Good waves'),
    bad:
      heightM < 0.5
        ? label('Very small waves')
        : heightM < 1
          ? label('Small waves')
          : heightM <= 4.5
            ? label('Big waves')
            : label('Waves too big'),
  };
}

/** Surfing needs waves; it is unavailable where Open-Meteo has no wave data (inland cities). */
export class SurfingScorer implements ActivityScorer {
  readonly activity = Activity.SURFING;

  score(day: DailyWeatherData): ScorerOutput {
    if (day.waveHeightMaxM === null) {
      return { available: false, reason: 'No wave data for this location' };
    }
    const w = cfg.weights;
    const period = day.wavePeriodMaxS;

    const factors: Factor[] = [
      waves(day.waveHeightMaxM),
      {
        label: 'Swell period',
        value: period === null ? undefined : `${round(period)} s`,
        weight: w.swellPeriod,
        score: period === null ? null : curveScore(cfg.periodS, period),
        limit: period === null ? undefined : curveScore(cfg.periodLimitS, period),
        good: period === null ? null : `Long swell (${round(period)} s)`,
        bad: period === null ? null : `Short, choppy swell (${round(period)} s)`,
      },
      {
        label: 'Wind',
        value: day.windMaxKmh === null ? undefined : `${round(day.windMaxKmh)} km/h`,
        weight: w.wind,
        score: day.windMaxKmh === null ? null : curveScore(cfg.windKmh, day.windMaxKmh),
        limit: day.windMaxKmh === null ? undefined : curveScore(cfg.windLimitKmh, day.windMaxKmh),
        good: null,
        bad: day.windMaxKmh === null ? null : `Strong wind (${round(day.windMaxKmh)} km/h)`,
      },
      {
        label: 'Air temperature',
        value: day.tempMaxC === null ? undefined : `${round(day.tempMaxC)} °C`,
        weight: w.temperature,
        score: day.tempMaxC === null ? null : curveScore(cfg.airTempC, day.tempMaxC),
        good: null,
        bad: day.tempMaxC === null ? null : `Cold air (${round(day.tempMaxC)} °C)`,
      },
      {
        label: 'Rain',
        value: day.precipitationMm === null ? undefined : `${day.precipitationMm.toFixed(1)} mm`,
        weight: w.rain,
        score: day.precipitationMm === null ? null : curveScore(cfg.rainMm, day.precipitationMm),
        good: null,
        bad: 'Heavy rain',
      },
    ];

    const caps: Cap[] = [];
    if (isThunderstorm(day.weatherCode)) {
      caps.push({ max: cfg.caps.thunderstorm, text: 'Thunderstorm' });
    }
    const { score, reasons, breakdown } = combine(factors, caps);
    return { available: true, score, reasons, breakdown };
  }
}
