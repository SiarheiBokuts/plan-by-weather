# plan-by-weather

A GraphQL service that takes a city or town and tells you how good each of the **next 7 days** is for
**skiing**, **surfing**, **outdoor sightseeing** and **indoor sightseeing**, with a score from 0 to 100
and a one-sentence explanation for every day. Weather comes from [Open-Meteo](https://open-meteo.com),
is **stored in Postgres**, and is refreshed **at most once every 6 hours per city**.

> This is a take-home exercise. Backend only, no front end. How it was planned and built is in
> [`openspec/`](openspec/changes/build-weather-activity-ranking) (proposal, design, specs, tasks)
> and [`docs/`](docs) (decisions, open questions, API research).

## Run it

You need only Docker.

```bash
git clone git@github.com:SiarheiBokuts/plan-by-weather.git
cd plan-by-weather
docker compose up --build
```

Then open **<http://localhost:3000/graphql>**: that is **Apollo Sandbox**, a ready-made interface in
your browser where you can read the schema documentation and run queries (a sample query is
pre-filled; press the play button). It loads its page assets from Apollo's CDN, so it needs internet
access; the service itself does not need it except to reach Open-Meteo.

| URL | What |
|---|---|
| <http://localhost:3000/graphql> | Apollo Sandbox and the GraphQL endpoint |
| <http://localhost:3000/health> | `{"status":"ok","database":"up","redis":"up"}` |

Prefer Postman? Import [`postman/plan-by-weather.postman_collection.json`](postman/plan-by-weather.postman_collection.json).

### Run the tests

```bash
docker compose run --rm tests
```

This runs, in one go: lint, a formatting check, the database migrations, and **all 317 tests**
(unit, integration against real Postgres and Redis, and end-to-end over HTTP) with a coverage
check (currently 100% of lines, 97% of branches). It exits non-zero if anything fails.
Open-Meteo is never called by the tests; they use responses recorded from the real API
([`test/fixtures`](test/fixtures)).

## Example

```graphql
query {
  activityRanking(city: "Innsbruck") {
    location { name country region }
    meta { source fetchedAt nextRefreshAt stale }
    byActivity { activity score rating bestDay available unavailableReason }
    byDay {
      date
      bestActivity
      weather { condition tempMaxC precipitationMm }
      activities { activity score rating summary }
    }
  }
}
```

Real answer (trimmed), first request, then the same request again:

```jsonc
{
  "location": { "name": "Innsbruck", "country": "Austria", "region": "Tyrol" },
  "meta": { "source": "OPEN_METEO", "fetchedAt": "2026-11-10T16:49:58Z",
            "nextRefreshAt": "2026-11-10T22:49:58Z", "stale": false },   // 2nd call: "DATABASE"
  "byActivity": [                    // best week first
    { "activity": "INDOOR_SIGHTSEEING",  "score": 72, "rating": "GOOD", "bestDay": "2026-11-13" },
    { "activity": "OUTDOOR_SIGHTSEEING", "score": 71, "rating": "GOOD", "bestDay": "2026-11-11" },
    { "activity": "SKIING",  "score": 5,    "rating": "POOR", "bestDay": "2026-11-10" },
    { "activity": "SURFING", "score": null, "available": false,
      "unavailableReason": "No wave data for this location" }
  ],
  "byDay": [{
    "date": "2026-11-10", "bestActivity": "INDOOR_SIGHTSEEING",
    "weather": { "condition": "Rain", "tempMaxC": 11.9, "precipitationMm": 0.8 },
    "activities": [
      { "activity": "OUTDOOR_SIGHTSEEING", "score": 74, "summary": "Light rain (0.8 mm), but good for exploring outside." },
      { "activity": "INDOOR_SIGHTSEEING",  "score": 70, "summary": "Light rain (0.8 mm): a good day for museums and indoor plans." },
      { "activity": "SKIING", "score": 5, "summary": "No snow on the ground: not a ski day." }
    ]
  }]
}
```

`meta.source` tells you where the numbers came from: **`OPEN_METEO`** (it was fetched just now) or
**`DATABASE`** (served from storage, no Open-Meteo call). `stale: true` means the stored data is older
than the refresh interval because a refresh was not possible.

Other query: `searchLocations(query, countryCode)` lists matching places (to find the right
`countryCode`). The full schema, with descriptions on every field, is in [`schema.gql`](schema.gql) and in Sandbox.

## How it works

```
GraphQL request ─► per-client limit (Redis) ─► find the city (Postgres, geocode once)
                                                    │
                       data younger than 6 h? ──yes─┴─► read from Postgres  ─┐
                              │ no                                           │
                  take a lock (Redis) so only ONE request refreshes          │
                              │                                              ▼
                  call Open-Meteo ─► store 7 days in Postgres ─► score every day and activity
                              │                                   (pure functions) ─► response
                  failed or "too many requests"? ─► pause calls, serve stored data marked stale,
                                                    or a clear error if the city is new
```

- **Storage** ([`prisma/schema.prisma`](prisma/schema.prisma)): `Location` (one row per real place,
  keyed by the geocoder's id so "Munich" and "Munchen" are one row), `LocationAlias` (what users
  typed, so repeated names never call the geocoder), `DailyWeather` (7 normalized days per place),
  `FetchState` (when a place may be refreshed again). Scores are not stored; they are computed on read,
  so changing a rule never leaves old numbers behind.
- **Refresh**: stored data is reused for 6 hours (`FORECAST_TTL_HOURS`). When it expires, one request
  refreshes it while concurrent requests wait for that result: ten simultaneous requests make one
  Open-Meteo call (tested).
- **Scoring** ([`src/scoring`](src/scoring)): one small, pure scorer per activity; every threshold is
  in [`scoring-config.ts`](src/scoring/scoring-config.ts). A score starts at a base and loses capped
  penalties (rain, wind, cold, heat, thunderstorm...), and every score comes with the reasons behind it.
  Indoor sightseeing is not just "the opposite of outdoor": it is always a fair option and gets better
  the worse it is outside.
- **Redis** holds only disposable data, always with an expiry: per-client request counters, the
  per-city refresh lock, and the "Open-Meteo asked us to wait until..." pause. It is started with a
  memory limit and `volatile-lru`, so when memory is full the oldest expiring keys are evicted instead
  of writes failing (verified, see [`docs/research`](docs/research/redis-eviction-check.sh)). If Redis
  is down the service keeps working with in-memory fallbacks and logs a warning.
- **Bounded storage**: at most `MAX_STORED_LOCATIONS` (1000) cities are kept; when a new one would
  exceed that, the least recently requested city is deleted with its data.

### Errors

Every error has a stable `extensions.code` and a message that is safe to show to a user.

| Code | When | Example message |
|---|---|---|
| `LOCATION_NOT_FOUND` | No such city | We couldn't find a city or town called "Atlantis". |
| `BAD_USER_INPUT` | Name under 2 characters, bad country code | Please enter at least 2 characters. |
| `CLIENT_RATE_LIMITED` | Too many requests from one client | Too many requests. Please try again in about 1 minute. |
| `OPEN_METEO_RATE_LIMITED` | Open-Meteo told us to slow down and we have nothing stored for this city | We can't load weather for this city right now. Please try again in about 15 minutes. |
| `OPEN_METEO_UNAVAILABLE` | Open-Meteo is down and we have nothing stored | The weather service is not reachable right now. Please try again in a few minutes. |

`CLIENT_RATE_LIMITED` and the two `OPEN_METEO_*` codes also carry `extensions.retryAfterSeconds`.
For a city we already stored, an Open-Meteo problem is **not** an error: the stored data is returned
with `stale: true`.

### Configuration

All optional; defaults are set in `docker-compose.yml` and [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `FORECAST_TTL_HOURS` | 6 | Minimum time between Open-Meteo refreshes of one city |
| `CLIENT_RATE_LIMIT` / `CLIENT_RATE_WINDOW_SECONDS` | 60 / 60 | Requests per client per window (client = `x-api-key` header, else IP) |
| `UPSTREAM_PAUSE_MINUTES` | 15 | Pause after Open-Meteo says "too many requests" without a retry time |
| `MAX_STORED_LOCATIONS` | 1000 | Cities kept before the least recently used is removed |
| `DATABASE_URL`, `REDIS_URL` | set by compose | Connections |

## Assumptions

The full list, with the question I would have asked a product manager, is in
[`docs/QUESTIONS.md`](docs/QUESTIONS.md). The important ones:

- "Ranking" means both: activities are ordered by their weekly score, and days are ranked within each activity.
- An ambiguous name ("Paris") resolves to the best-ranked town or city; the response says which one, and `countryCode` picks another.
- A score of 0-100 is a rule of thumb that can be explained ("Rain (12.0 mm): not a day for walking around."), not a meteorological model.
- Clients are anonymous: identified by `x-api-key` if sent, otherwise by IP.

## Known limitations

- **Skiing is judged at the city, not at the slopes.** Snow in a valley town says little about the
  nearby resorts, so a ski town can score low in a snowless valley. Finding nearby resorts is future work.
- **Surfing needs the Marine API**, which has no data for inland cities; surfing is then reported as
  unavailable rather than zero.
- **Open-Meteo's free tier** is non-commercial, limited to 600 calls/min, 5,000/hour, 10,000/day, with no uptime guarantee.
  The service is built to live with that (see below), but it is not a commercial setup.
- Only the first, best-ranked match of an ambiguous name is used unless a `countryCode` is given.
- Scores are heuristics; thresholds were chosen to be sensible and explainable, not calibrated.

## Open-Meteo API notes

Measured against the live API (details and raw samples in [`docs/research/`](docs/research/open-meteo-findings.md)):

- Free tier: 600 calls/min, 5,000/hour, 10,000/day; non-commercial use only; no uptime guarantee.
- **Cost is counted per location, not per request.** One location costs 1.0, three cost 3.0, ten cost 10.0 (header `X-RateLimit-Cost`). Batching several cities into one request therefore saves HTTP round trips, **not quota**. Cost also grows with the number of requested variables (12 daily + 2 hourly measured at 1.4).
- Version one makes one call per location, triggered by one user request. Batching is kept as future work: it would help a background refresh job.
- The real savings are the 6-hour refresh interval, requesting only the fields the scorers use, and skipping the marine API for inland cities.
- When Open-Meteo answers "too many requests", the service pauses calls, serves stored data as stale, and returns a clear error with an approximate retry time for new cities.
- At roughly 10 quota units per city per day, the 10,000/day allowance keeps about 800 cities fresh.

## What I cut, and why

- **Usage counters for the Open-Meteo allowance.** Reacting to its `429` answer (one shared pause key) is
  much simpler and the 6-hour interval keeps usage far below the limits. Cost: one wasted request when the limit is first hit.
- **A response cache in Redis.** Postgres already answers in milliseconds; another layer would add complexity for no visible gain.
- **Background refresh of popular cities**, **batching cities per request**, **nearby ski resorts**, **a
  stricter limit for requests that need an Open-Meteo call**, **forecast history** (where a time-series
  store would make sense). All described in
  [`openspec/.../design.md`](openspec/changes/build-weather-activity-ranking/design.md) under *Future Improvements*.
- **Authentication.** Out of scope; clients are anonymous and rate limited.
- **Prisma 7 and NestJS 12.** NestJS 12 is ESM-only, which would mean rewriting the project's module system; Prisma 7 needs driver adapters and a new config file. Both are worthwhile upgrades, not worth the risk here. Everything else is on current versions (Node 24, TypeScript 6, Jest 30, ESLint 10, Postgres 18, Redis 8).

## Project layout

```
src/
  open-meteo/   HTTP client, response mapping, the pause after "too many requests"
  locations/    find a city, remember it, keep the number of stored cities bounded
  forecast/     the 6-hour rule, the refresh lock, stale fallback
  scoring/      the rules: one scorer per activity, summaries, weekly aggregation (no I/O)
  ranking/      GraphQL types and resolver, composes the services
  throttling/   per-client request limit
  redis/ prisma/ common/ config/ health/
test/           integration + end-to-end tests, recorded Open-Meteo responses, helpers
prisma/         schema and migrations (see prisma/README.md)
openspec/       the plan: proposal, design, specs, tasks
docs/           decisions, open questions, API research
postman/        importable request collection
```

Database migrations: see [`prisma/README.md`](prisma/README.md). Useful scripts: `npm run check`
(what the test container runs), `npm run prisma:migrate`, `npm run prisma:migrate:dev`.
