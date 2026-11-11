import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SCORING } from './scoring-config';
import { renderScoringDocs } from './generate-scoring-docs';

const file = join(__dirname, 'SCORING.md');

describe('SCORING.md, the readable version of the scoring config', () => {
  it('matches scoring-config.ts (run `npm run docs:scoring` after changing the config)', () => {
    const expected = renderScoringDocs();
    if (process.env.UPDATE_SCORING_DOCS) writeFileSync(file, expected);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(expected);
  });

  it('shows the rain table the way a person would read it', () => {
    const text = renderScoringDocs();
    expect(text).toContain('| 0 | 100 | ideal |');
    expect(text).toContain('| 10 | 8 | very bad |');
  });

  it('lists every activity and its weights', () => {
    const text = renderScoringDocs();
    for (const heading of ['Outdoor sightseeing', 'Skiing', 'Surfing', 'Indoor sightseeing']) {
      expect(text).toContain(`## ${heading}`);
    }
    expect(text).toContain(Object.keys(SCORING.outdoor.weights)[0]);
  });
});
