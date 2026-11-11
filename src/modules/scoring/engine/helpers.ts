import { SCORING } from '../config/scoring-config';
import { Rating } from '../types';

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const finalScore = (raw: number): number => Math.round(clamp(raw, 0, 100));

export function ratingFor(score: number): Rating {
  if (score >= SCORING.bands.great) return Rating.GREAT;
  if (score >= SCORING.bands.good) return Rating.GOOD;
  if (score >= SCORING.bands.fair) return Rating.FAIR;
  return Rating.POOR;
}

export const round = (value: number): number => Math.round(value);
