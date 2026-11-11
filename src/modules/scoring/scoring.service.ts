import { Injectable } from '@nestjs/common';
import { DailyWeatherData } from '../../domain/daily-weather';
import { ratingFor } from './engine/helpers';
import { Breakdown } from './engine/model';
import { IndoorSightseeingScorer } from './scorers/indoor.scorer';
import { OutdoorSightseeingScorer } from './scorers/outdoor.scorer';
import { SkiingScorer } from './scorers/skiing.scorer';
import { SurfingScorer } from './scorers/surfing.scorer';
import { buildSummary } from './engine/summary';
import { ACTIVITIES, Activity, ActivityScorer, Rating } from './types';

/** Score of one activity on one day. */
export interface ActivityDayScore {
  activity: Activity;
  date: string;
  available: boolean;
  score: number | null;
  rating: Rating | null;
  /** One plain-language sentence, e.g. "Rain (12.0 mm): not a day for walking around." */
  summary: string;
  reasons: string[];
  /** How the score came about, condition by condition; null when unavailable */
  breakdown: Breakdown | null;
  unavailableReason: string | null;
}

export interface RankedActivityDay extends ActivityDayScore {
  /** 1 = the best day of the week for this activity; null when unavailable */
  rank: number | null;
}

export interface ActivityOutlook {
  activity: Activity;
  available: boolean;
  unavailableReason: string | null;
  /** The 7-day average of the daily scores (days without data are left out) */
  score: number | null;
  rating: Rating | null;
  /** The highest-scoring day (the earliest one when several days tie) */
  bestDay: string | null;
  /** Every day that has the highest score (more than one when days tie), oldest first */
  bestDays: string[];
  days: RankedActivityDay[];
}

export interface DayOutlook {
  date: string;
  weather: DailyWeatherData;
  /** Available activities best first, unavailable ones last */
  activities: ActivityDayScore[];
  bestActivity: Activity | null;
}

export interface Outlook {
  /** Ordered by the 7-day average score, best first */
  byActivity: ActivityOutlook[];
  byDay: DayOutlook[];
}

const byScoreDesc = (a: { score: number | null }, b: { score: number | null }): number =>
  (b.score ?? -1) - (a.score ?? -1);

/** Turns stored weather into the 7-day outlook: one scorer per activity, then two views. */
@Injectable()
export class ScoringService {
  private readonly scorers: ActivityScorer[] = [
    new SkiingScorer(),
    new SurfingScorer(),
    new OutdoorSightseeingScorer(),
    new IndoorSightseeingScorer(),
  ];

  /** Scores one activity for one day. */
  scoreDay(scorer: ActivityScorer, day: DailyWeatherData): ActivityDayScore {
    const output = scorer.score(day);
    if (!output.available) {
      return {
        activity: scorer.activity,
        date: day.date,
        available: false,
        score: null,
        rating: null,
        summary: `${output.reason}.`,
        reasons: [],
        breakdown: null,
        unavailableReason: output.reason,
      };
    }
    const rating = ratingFor(output.score);
    return {
      activity: scorer.activity,
      date: day.date,
      available: true,
      score: output.score,
      rating,
      summary: buildSummary(scorer.activity, rating, output.reasons),
      reasons: output.reasons.map((reason) => reason.text),
      breakdown: output.breakdown,
      unavailableReason: null,
    };
  }

  buildOutlook(days: DailyWeatherData[]): Outlook {
    // One matrix feeds both views, so the numbers can never disagree.
    const matrix = this.scorers.map((scorer) => days.map((day) => this.scoreDay(scorer, day)));

    const byActivity = matrix.map((row, index) =>
      this.summarizeActivity(this.scorers[index].activity, row),
    );
    byActivity.sort((a, b) => byScoreDesc(a, b) || this.order(a.activity) - this.order(b.activity));

    const byDay: DayOutlook[] = days.map((weather, dayIndex) => {
      const activities = matrix.map((row) => row[dayIndex]);
      activities.sort(
        (a, b) => byScoreDesc(a, b) || this.order(a.activity) - this.order(b.activity),
      );
      return {
        weather,
        date: weather.date,
        activities,
        bestActivity: activities[0]?.available ? activities[0].activity : null,
      };
    });

    return { byActivity, byDay };
  }

  private summarizeActivity(activity: Activity, row: ActivityDayScore[]): ActivityOutlook {
    const available = row.filter((day) => day.available);

    const ranked = [...available].sort(
      (a, b) => (b.score as number) - (a.score as number) || a.date.localeCompare(b.date),
    );
    const rankByDate = new Map(ranked.map((day, index) => [day.date, index + 1]));
    const days: RankedActivityDay[] = row.map((day) => ({
      ...day,
      rank: rankByDate.get(day.date) ?? null,
    }));

    if (available.length === 0) {
      return {
        activity,
        available: false,
        unavailableReason: row[0]?.unavailableReason ?? 'No data',
        score: null,
        rating: null,
        bestDay: null,
        bestDays: [],
        days,
      };
    }

    const average = Math.round(
      available.reduce((sum, day) => sum + (day.score as number), 0) / available.length,
    );
    return {
      activity,
      available: true,
      unavailableReason: null,
      score: average,
      rating: ratingFor(average),
      bestDay: ranked[0].date,
      bestDays: ranked.filter((day) => day.score === ranked[0].score).map((day) => day.date),
      days,
    };
  }

  private order(activity: Activity): number {
    return ACTIVITIES.indexOf(activity);
  }
}
