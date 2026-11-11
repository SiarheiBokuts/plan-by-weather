<!-- GENERATED from scoring-config.ts by `npm run docs:scoring`. Do not edit by hand. -->
# Scoring tables

Every number the service uses to judge a day. For each measured value a **mark from 0 (very bad) to 100
(ideal)** is read from the table below; between two rows the mark moves in a straight line, and beyond
the first or last row it stays flat. Example: 0 mm of rain has mark 100, 10 mm has mark 8, and 3 mm lies
between the 2.5 and 5 mm rows. Marks are multiplied by the weights and added up; a *ceiling* table
caps the total whenever that one condition is bad enough. How it all fits together is explained in the
README, section "How a score is calculated"; the final formula is in `model.ts`.

To change a rule: edit the numbers in `scoring-config.ts`, then run `npm run docs:scoring` to rewrite
this file (a test fails if the two disagree) and check `scoring.calibration.spec.ts` still passes.

Ratings: below 40 POOR, 40-59 FAIR, 60-79 GOOD, 80 and above GREAT.

## Outdoor sightseeing

A good day for walking around town: dry, comfortable, bright, calm, clear.

Weights (points each condition can earn, adding up to 100): precipitation 30, temperature 35, sky 15, wind 10, visibility 10.

**Rain** (mm per day) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 100 | ideal |
| 0.2 | 95 | ideal |
| 0.5 | 80 | good |
| 1 | 62 | so-so |
| 2.5 | 45 | so-so |
| 5 | 28 | bad |
| 10 | 8 | very bad |
| 20 | 0 | very bad |

**Rain** (mm per day) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 100 |
| 2.5 | 100 |
| 5 | 40 |
| 10 | 20 |
| 20 | 10 |

**Snowfall** (cm per day, used instead of rain when it snows) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 100 | ideal |
| 1 | 65 | so-so |
| 3 | 35 | bad |
| 8 | 8 | very bad |

**Felt temperature** (°C) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| -10 | 0 | very bad |
| 0 | 12 | very bad |
| 5 | 30 | bad |
| 10 | 62 | so-so |
| 14 | 85 | good |
| 18 | 100 | ideal |
| 24 | 100 | ideal |
| 28 | 80 | good |
| 32 | 50 | so-so |
| 36 | 20 | bad |
| 40 | 0 | very bad |

**Felt temperature** (°C) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| -10 | 10 |
| 0 | 50 |
| 5 | 60 |
| 10 | 80 |
| 14 | 100 |
| 28 | 100 |
| 32 | 70 |
| 36 | 48 |
| 40 | 25 |

**Cloud cover** (% of the sky) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 100 | ideal |
| 25 | 95 | ideal |
| 50 | 78 | good |
| 75 | 52 | so-so |
| 100 | 25 | bad |

**Sunshine** (hours, used when cloud cover is unknown) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 35 | bad |
| 2 | 58 | so-so |
| 5 | 85 | good |
| 8 | 100 | ideal |

**Wind** (km/h) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 15 | 100 | ideal |
| 25 | 90 | ideal |
| 35 | 70 | good |
| 50 | 38 | bad |
| 70 | 10 | very bad |
| 90 | 0 | very bad |

**Wind** (km/h) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 100 |
| 30 | 100 |
| 45 | 70 |
| 60 | 50 |
| 80 | 30 |

Fog: mark 20 (no fog: 100) and a ceiling of 50.

Dealbreakers: a thunderstorm caps the score at 20; gusts of 80 km/h or more cap it at 40.


## Skiing

Needs snow first; cold, calm, clear weather keeps it good.

Weights (points each condition can earn, adding up to 100): snow depth 40, fresh snow 10, temperature 25, wind 15, visibility 10.

**Snow on the ground** (cm) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 0 | very bad |
| 5 | 10 | very bad |
| 15 | 40 | so-so |
| 30 | 65 | so-so |
| 60 | 92 | ideal |
| 100 | 100 | ideal |

**Snow on the ground** (cm) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 5 |
| 5 | 40 |
| 15 | 60 |
| 30 | 85 |
| 60 | 100 |

**New snow today** (cm) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 65 | so-so |
| 3 | 80 | good |
| 10 | 100 | ideal |

**Warmest temperature of the day** (°C) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| -25 | 40 | so-so |
| -15 | 75 | good |
| -8 | 100 | ideal |
| -2 | 100 | ideal |
| 0 | 85 | good |
| 2 | 55 | so-so |
| 5 | 25 | bad |
| 10 | 5 | very bad |

**Warmest temperature of the day** (°C) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 1 | 100 |
| 3 | 70 |
| 6 | 45 |
| 10 | 25 |

**Wind** (km/h) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 15 | 100 | ideal |
| 30 | 85 | good |
| 45 | 50 | so-so |
| 60 | 20 | bad |
| 80 | 0 | very bad |

**Wind** (km/h) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 100 |
| 35 | 100 |
| 50 | 70 |
| 65 | 45 |
| 80 | 25 |

Fog: mark 25 (no fog: 100).

Dealbreakers: less than 5 cm of snow and less than 2 cm of new snow caps the score at 5; rain falling on snow (at least 2 mm, mostly rain, above 1 °C) caps it at 45.


## Surfing

Needs waves; only judged where Open-Meteo has wave data (not for inland cities).

Weights (points each condition can earn, adding up to 100): wave height 40, swell period 20, wind 20, temperature 10, rain 10.

**Wave height (highest of the day)** (metres) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 0 | very bad |
| 0.3 | 8 | very bad |
| 0.6 | 35 | bad |
| 1 | 65 | so-so |
| 1.5 | 90 | ideal |
| 2 | 100 | ideal |
| 2.5 | 96 | ideal |
| 3.5 | 72 | good |
| 4.5 | 40 | so-so |
| 6 | 10 | very bad |

**Wave height** (metres) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 5 |
| 0.3 | 15 |
| 0.6 | 45 |
| 1 | 75 |
| 1.5 | 100 |
| 3 | 100 |
| 4 | 70 |
| 5 | 45 |
| 6 | 25 |
| 8 | 10 |

**Swell period** (seconds) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 4 | 15 | bad |
| 6 | 40 | so-so |
| 8 | 75 | good |
| 10 | 100 | ideal |
| 14 | 100 | ideal |

**Swell period** (seconds) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 4 | 35 |
| 6 | 60 |
| 8 | 90 |
| 10 | 100 |

**Wind** (km/h) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 10 | 100 | ideal |
| 20 | 88 | good |
| 30 | 60 | so-so |
| 45 | 25 | bad |
| 60 | 5 | very bad |

**Wind** (km/h) also limits the whole score to at most:

| Measured | Highest total score allowed |
|---|---|
| 0 | 100 |
| 20 | 100 |
| 30 | 80 |
| 45 | 50 |
| 60 | 25 |

**Warmest air temperature** (°C) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 20 | bad |
| 8 | 50 | so-so |
| 14 | 85 | good |
| 18 | 100 | ideal |

**Rain** (mm per day) gives this mark:

| Measured | Mark (0-100) | Meaning |
|---|---|---|
| 0 | 100 | ideal |
| 5 | 80 | good |
| 10 | 50 | so-so |
| 20 | 10 | very bad |

Dealbreakers: a thunderstorm caps the score at 20.


## Indoor sightseeing

Not measured on its own. Indoor sights are always an option, so a calm lovely day still scores
**60**. The worse the weather is for walking outside, the better it is for museums:

    indoor score = 60 + 40% of the points the outdoor score lost (100 minus the outdoor score)
                   minus 15 when it is dangerous to travel

Dangerous to travel: a thunderstorm, gusts of 70 km/h or more, or 15 cm of snowfall or more.
