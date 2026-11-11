import { Curve } from '../engine/model';
import { SCORING } from './scoring-config';

/**
 * DOCUMENTATION GENERATOR (the service does not use it at runtime).
 * Renders the numbers of scoring-config.ts as plain tables for people ("rain 0 mm = 100, ideal;
 * 10 mm = 8, very bad") into SCORING.md next to this file, which the README links to. A test fails
 * when SCORING.md no longer matches the config, so that documentation always shows the numbers the
 * code really uses. After changing scoring-config.ts run `npm run docs:scoring` to refresh it.
 */

const MARK_WORDS: [number, string][] = [
  [90, 'ideal'],
  [70, 'good'],
  [40, 'so-so'],
  [15, 'bad'],
  [0, 'very bad'],
];
/** "snowDepth" -> "snow depth" */
const words = (name: string): string => name.replace(/([A-Z])/g, ' $1').toLowerCase();
const word = (mark: number): string => MARK_WORDS.find(([from]) => mark >= from)![1];

/** What a curve table measures: its title, unit and whether it gives a mark or a ceiling. */
interface Table {
  title: string;
  unit: string;
  curve: Curve;
  kind: 'mark' | 'ceiling';
}

function renderTable(table: Table): string {
  const head =
    table.kind === 'mark'
      ? `**${table.title}** (${table.unit}) gives this mark:`
      : `**${table.title}** (${table.unit}) also limits the whole score to at most:`;
  const rows = table.curve.map(([value, mark]) =>
    table.kind === 'mark' ? `| ${value} | ${mark} | ${word(mark)} |` : `| ${value} | ${mark} |`,
  );
  const header =
    table.kind === 'mark'
      ? '| Measured | Mark (0-100) | Meaning |\n|---|---|---|'
      : '| Measured | Highest total score allowed |\n|---|---|';
  return `${head}\n\n${header}\n${rows.join('\n')}\n`;
}

const mark = (title: string, unit: string, curve: Curve): Table => ({
  title,
  unit,
  curve,
  kind: 'mark',
});
const ceiling = (title: string, unit: string, curve: Curve): Table => ({
  title,
  unit,
  curve,
  kind: 'ceiling',
});

function section(
  heading: string,
  intro: string,
  weights: Record<string, number>,
  tables: Table[],
): string {
  const weightLine = Object.entries(weights)
    .map(([name, weight]) => `${words(name)} ${weight}`)
    .join(', ');
  return [
    `## ${heading}`,
    '',
    intro,
    '',
    `Weights (points each condition can earn, adding up to 100): ${weightLine}.`,
    '',
    ...tables.map(renderTable),
  ].join('\n');
}

export function renderScoringDocs(): string {
  const o = SCORING.outdoor;
  const s = SCORING.skiing;
  const f = SCORING.surfing;
  const i = SCORING.indoor;
  const b = SCORING.bands;

  return [
    '<!-- GENERATED from scoring-config.ts by `npm run docs:scoring`. Do not edit by hand. -->',
    '# Scoring tables',
    '',
    'Every number the service uses to judge a day. For each measured value a **mark from 0 (very bad) to 100',
    '(ideal)** is read from the table below; between two rows the mark moves in a straight line, and beyond',
    'the first or last row it stays flat. Example: 0 mm of rain has mark 100, 10 mm has mark 8, and 3 mm lies',
    'between the 2.5 and 5 mm rows. Marks are multiplied by the weights and added up; a *ceiling* table',
    'caps the total whenever that one condition is bad enough. How it all fits together is explained in the',
    'README, section "How a score is calculated"; the final formula is in `model.ts`.',
    '',
    'To change a rule: edit the numbers in `scoring-config.ts`, then run `npm run docs:scoring` to rewrite',
    'this file (a test fails if the two disagree) and check `scoring.calibration.spec.ts` still passes.',
    '',
    `Ratings: below ${b.fair} POOR, ${b.fair}-${b.good - 1} FAIR, ${b.good}-${b.great - 1} GOOD, ${b.great} and above GREAT.`,
    '',
    section(
      'Outdoor sightseeing',
      'A good day for walking around town: dry, comfortable, bright, calm, clear.',
      o.weights,
      [
        mark('Rain', 'mm per day', o.rainMm),
        ceiling('Rain', 'mm per day', o.rainLimitMm),
        mark('Snowfall', 'cm per day, used instead of rain when it snows', o.snowCm),
        mark('Felt temperature', '°C', o.feltTempC),
        ceiling('Felt temperature', '°C', o.tempLimitC),
        mark('Cloud cover', '% of the sky', o.cloudPct),
        mark('Sunshine', 'hours, used when cloud cover is unknown', o.sunshineHours),
        mark('Wind', 'km/h', o.windKmh),
        ceiling('Wind', 'km/h', o.windLimitKmh),
      ],
    ) +
      `\nFog: mark ${o.fogScore} (no fog: 100) and a ceiling of ${o.fogLimit}.\n\n` +
      `Dealbreakers: a thunderstorm caps the score at ${o.caps.thunderstorm}; gusts of ${o.caps.gustKmh} km/h or more cap it at ${o.caps.gustMax}.\n`,
    '',
    section('Skiing', 'Needs snow first; cold, calm, clear weather keeps it good.', s.weights, [
      mark('Snow on the ground', 'cm', s.snowDepthCm),
      ceiling('Snow on the ground', 'cm', s.depthLimitCm),
      mark('New snow today', 'cm', s.freshSnowCm),
      mark('Warmest temperature of the day', '°C', s.tempMaxC),
      ceiling('Warmest temperature of the day', '°C', s.tempLimitC),
      mark('Wind', 'km/h', s.windKmh),
      ceiling('Wind', 'km/h', s.windLimitKmh),
    ]) +
      `\nFog: mark ${s.fogScore} (no fog: 100).\n\n` +
      `Dealbreakers: less than ${s.caps.minDepthCm} cm of snow and less than ${s.caps.minFreshCm} cm of new snow caps the score at ${s.caps.noSnow}; ` +
      `rain falling on snow (at least ${s.caps.rainOnSnow.minMm} mm, mostly rain, above ${s.caps.rainOnSnow.aboveC} °C) caps it at ${s.caps.rainOnSnow.max}.\n`,
    '',
    section(
      'Surfing',
      'Needs waves; only judged where Open-Meteo has wave data (not for inland cities).',
      f.weights,
      [
        mark('Wave height (highest of the day)', 'metres', f.waveM),
        ceiling('Wave height', 'metres', f.waveLimitM),
        mark('Swell period', 'seconds', f.periodS),
        ceiling('Swell period', 'seconds', f.periodLimitS),
        mark('Wind', 'km/h', f.windKmh),
        ceiling('Wind', 'km/h', f.windLimitKmh),
        mark('Warmest air temperature', '°C', f.airTempC),
        mark('Rain', 'mm per day', f.rainMm),
      ],
    ) + `\nDealbreakers: a thunderstorm caps the score at ${f.caps.thunderstorm}.\n`,
    '',
    '## Indoor sightseeing',
    '',
    'Not measured on its own. Indoor sights are always an option, so a calm lovely day still scores',
    `**${i.base}**. The worse the weather is for walking outside, the better it is for museums:`,
    '',
    `    indoor score = ${i.base} + ${i.bonusFactor * 100}% of the points the outdoor score lost (100 minus the outdoor score)`,
    `                   minus ${i.severe.penalty} when it is dangerous to travel`,
    '',
    `Dangerous to travel: a thunderstorm, gusts of ${i.severe.gustKmh} km/h or more, or ${i.severe.snowfallCm} cm of snowfall or more.`,
    '',
  ].join('\n');
}
