import { clamp, finalScore, ratingFor, round } from './helpers';
import { Rating } from '../types';

describe('scoring helpers', () => {
  it('clamp keeps a value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('finalScore rounds and clamps to 0-100', () => {
    expect(finalScore(72.4)).toBe(72);
    expect(finalScore(-30)).toBe(0);
    expect(finalScore(140)).toBe(100);
  });

  it('round rounds to the nearest whole number', () => {
    expect(round(2.5)).toBe(3);
  });

  it.each([
    [0, Rating.POOR],
    [39, Rating.POOR],
    [40, Rating.FAIR],
    [59, Rating.FAIR],
    [60, Rating.GOOD],
    [79, Rating.GOOD],
    [80, Rating.GREAT],
    [100, Rating.GREAT],
  ])('score %s is %s', (score, rating) => {
    expect(ratingFor(score)).toBe(rating);
  });
});
