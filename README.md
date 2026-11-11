# 🌤️ plan-by-weather

A GraphQL service that takes a city or town and tells you how good each of the **next 7 days** is for
**skiing**, **surfing**, **outdoor sightseeing** and **indoor sightseeing**: a score from 0 to 100 and a
one-sentence explanation per day. Weather comes from [Open-Meteo](https://open-meteo.com), is **stored in
Postgres** and is refreshed **at most once every 6 hours per city**.

> **Take-home exercise, backend only.** How it was planned and decided is in [`docs/DECISIONS.md`](docs/DECISIONS.md),
> [`docs/QUESTIONS.md`](docs/QUESTIONS.md) (the questions I would have asked a product manager, and the assumption
> I took) and [`openspec/`](openspec/changes/build-weather-activity-ranking) (proposal, design, specs, tasks).

**Stack:** **Node 24** · **TypeScript** · **NestJS** · **GraphQL** (Apollo, code-first) · **Postgres** (Prisma) · **Redis** · **Docker** · **Jest**

### 📑 Contents

- [🚀 Run it](#-run-it)
- [🧪 Tests and CI](#-tests-and-ci)
- [🔌 The API](#-the-api)
- [🧮 How a score is calculated](#-how-a-score-is-calculated)
- [🔄 How it works](#-how-it-works)
- [📌 Assumptions and limitations](#-assumptions-and-limitations)
- [🚧 What I cut, and why](#-what-i-cut-and-why)
- [🔧 Configuration](#-configuration)
- [📁 Project layout](#-project-layout)
- [💻 Test UI (extra, not part of the assignment)](#-test-ui-extra-not-part-of-the-assignment)

## 🚀 Run it

**Only Docker (Compose v2) is needed**; Node is not. Free host ports: **4747** (service), **54329** (Postgres) and **63799** (Redis); they are unusual on purpose.
If one is taken, set `APP_PORT`, `POSTGRES_PORT` or `REDIS_PORT` before starting, e.g. `APP_PORT=5050 docker compose up --build`.

```bash
git clone https://github.com/SiarheiBokuts/plan-by-weather.git && cd plan-by-weather
docker compose up --build        # runs in the foreground, with the logs (Ctrl+C stops it)
```

It builds the image, starts the service, Postgres and Redis, and applies the database migrations. Then open:

| **URL** | **What** |
|---|---|
| <http://localhost:4747/graphql> | **Apollo Sandbox** (a ready-made query for every operation is pre-filled) and the GraphQL endpoint |
| <http://localhost:4747/health> | the **health check**: `{"status":"ok","database":"up","redis":"up"}` |
| <http://localhost:4747/ui> | the **test UI** (see the end of this file) |

**Cities worth trying**
- **Surfing needs waves, so search a coastal place**: `Nazaré` (Portugal, big waves) or `Biarritz` (France). For an inland city, such as Innsbruck or Munich, surfing is shown as "unavailable", not as 0.
- **Skiing** scores high only where snow lies: try `Zermatt` or `Innsbruck` in winter; in a snowless valley it stays low.
- **A name that exists in several places**: `Paris` (France or Texas); pick another with `countryCode`.

**Three ways to try the API**

| Tool | What it is |
|---|---|
| **Apollo Sandbox** | the page at `/graphql`: a query editor in the browser with the schema documentation, and a ready-made query for every operation |
| **Test UI** | the small web page at `/ui` (an extra, see the end of this file) |
| **Postman** | an importable collection of requests: [`postman/`](postman/plan-by-weather.postman_collection.json) |

**Using Apollo Sandbox**
- **Run starts the operation the cursor is in**: click inside `Ranking` or `SearchLocations`, then press Run.
- Sandbox remembers tabs from earlier visits. If you see an old query or a greyed-out Run, **open a new tab with `+`** (or a private window).
- Sandbox is on only because `docker-compose.yml` sets `GRAPHQL_SANDBOX=true` for this demo. **The default is off** (no page and no schema introspection), which is what a real deployment should use.

**Logs**: one line per request and per important event. Follow them until you press Ctrl+C:
```bash
npm run logs        # the service: the last 100 lines, then new ones as they appear
npm run logs:all    # service + Postgres + Redis together
docker compose logs -f --tail=100 app    # the same as `npm run logs`, without npm
```
What they look like. **Request 1**, a city seen for the first time (the weather is fetched from Open-Meteo):
```
[LocationsService] New place "Munich" (DE) found for "munchen"
[ForecastService]  Refreshing the forecast of Munich (id 3) from Open-Meteo
[OpenMeteoClient]  Open-Meteo forecast answered 200 in 312 ms
[ForecastService]  Stored 7 days for Munich (waves: no); next refresh after 2026-11-11T16:20:00.000Z
[RankingService]   Ranking "Munchen" -> Munich, DE | weather just fetched from Open-Meteo | 655 ms
```
**Request 2**, the same city a little later (nothing is fetched, the answer comes from the database):
```
[RankingService]   Ranking "Munchen" -> Munich, DE | weather from the database (fetched 12 min ago, next refresh in 5 h 48 min) | 9 ms
```
The last part of every `Ranking` line says where the numbers came from and how long the request took.
**Warnings** tell what went wrong: Open-Meteo answered 429 and calls are paused, an `OUTDATED weather` answer was served, a client went over the limit, Redis is down.

**Commands.** The `npm run ...` shortcuts need Node and npm on your machine; each one only calls the Docker commands shown above.

| **Command** | **What it does** |
|---|---|
| `npm run up` / `npm run down` | **start** in the background (and print the addresses, also for other devices on the same Wi-Fi: `npm run lan`) / **stop** (data stays; `docker compose down -v` wipes it) |
| `npm run logs` / `npm run logs:all` | follow the service logs / all containers' logs (Ctrl+C to stop) |
| `npm run test:docker` | lint, migrations, all tests |
| `npm run start:dev` | run from source with [`.env.dev`](.env.dev) on port 4748 (after `docker compose up -d postgres redis`); it can run next to the Docker app on 4747 |
| `npm run docs:scoring` | rewrite `src/modules/scoring/config/SCORING.md` after changing the scoring numbers |

## 🧪 Tests and CI

**Run them** (only Docker is needed):
```bash
npm run test:docker                       # or, without npm:  docker compose run --build --rm tests
```
It runs **four steps** and prints a clear result for each:
1. **Lint** (code rules)
2. **Format check** (code style)
3. **Database migrations**
4. **All tests**, with a **coverage** check

It ends with **`ALL CHECKS PASSED`**, or names the step that failed.

**What is real in the tests and what is replaced**

| **Part** | **In the tests** |
|---|---|
| **Postgres and Redis** | **real**: the two containers that Docker starts on your machine (own schema `test` and Redis db `1`, so your data is not touched) |
| **Open-Meteo** (the weather API) | **never real**: answers recorded once from the real API ([`test/fixtures`](test/fixtures)) are served instead. **No internet is needed**, and the test setup **blocks the network**, so a test that forgot this would fail with "A test tried to call the real network" (one test checks that) |
| **The clock** | a **fake clock**, so tests control "now" |

**What is tested**
- **Unit tests**: the scoring rules, the configuration, the error types, each service on its own with fakes.
- **Integration tests**: the real services with the real Postgres and Redis above and the recorded weather answers. They cover storing and refreshing weather,
  the **lock** (ten simultaneous requests make **one** Open-Meteo call) and **unique keys**.
- **End-to-end tests over HTTP**: the GraphQL API and its errors, Apollo Sandbox, the test UI.
- Test names read as plain expectations ("lowers the score the harder it rains"), so they double as documentation.

**GitHub runs them too.** The same command runs on **every push and pull request** (the **pipeline** is in
[`.github/workflows/tests.yml`](.github/workflows/tests.yml)). Open the repository's
[**Actions** tab](https://github.com/SiarheiBokuts/plan-by-weather/actions) to see the pipeline and its result for each commit, with the full log of every step.

## 🔌 The API

**Two read-only GraphQL queries** and **one REST check**. Every field has a description in the schema ([`schema.gql`](schema.gql), and the docs panel of Sandbox).

| **Call** | **What it does** | **Arguments** |
|---|---|---|
| **`activityRanking`** | Ranks the next 7 days for the four activities in one city: the place chosen, where the data came from (`meta`), activities ordered by their 7-day average score (`byActivity`) and the same scores day by day (`byDay`), each with a summary and the `breakdown` behind the score. | `city` (≥ 2 chars), `countryCode` (optional, ISO, e.g. `US`) |
| **`searchLocations`** | Up to 5 cities matching a name, best first; loads no weather. Use it when a name is ambiguous ("Paris"), then pass the right `countryCode`. | `query`, `countryCode` (optional) |
| **`GET /health`** | 200, or 503 if the database is down. | |

```graphql
query {
  activityRanking(city: "Innsbruck") {
    location { name country region }
    meta { source fetchedAt nextRefreshAt outdated }
    byActivity { activity score rating bestDay available unavailableReason }
    byDay { date bestActivity weather { condition tempMaxC precipitationMm }
            activities { activity score rating summary } }
  }
}
```

```jsonc
{ "location": { "name": "Innsbruck", "country": "Austria", "region": "Tyrol" },
  "meta": { "source": "OPEN_METEO", "outdated": false, ... },       // 2nd call: "DATABASE"
  "byActivity": [                                                  // best 7-day average first
    { "activity": "INDOOR_SIGHTSEEING",  "score": 77, "rating": "GOOD", "bestDay": "2026-11-13" },
    { "activity": "OUTDOOR_SIGHTSEEING", "score": 58, "rating": "FAIR", "bestDay": "2026-11-11" },
    { "activity": "SKIING",  "score": 5, "rating": "POOR" },
    { "activity": "SURFING", "score": null, "available": false, "unavailableReason": "No wave data for this location" } ],
  "byDay": [ { "date": "2026-11-12", "bestActivity": "INDOOR_SIGHTSEEING",
      "weather": { "condition": "Rain", "tempMaxC": 12, "precipitationMm": 6.9 },
      "activities": [
        { "activity": "INDOOR_SIGHTSEEING",  "score": 87, "summary": "Rain (6.9 mm): a perfect day for museums and indoor plans." },
        { "activity": "OUTDOOR_SIGHTSEEING", "score": 32, "summary": "Rain (6.9 mm): not a day for walking around." } ] } ] }  // ...six more days
```

**What the numbers mean**
- In `byActivity`, **`score`** is the **7-day average** of that activity's daily scores (days without data are left out).
- **`rating`** is the word for that average, and **`bestDay`** is the day with the highest score.
- A single day's own score is in `days` (inside `byActivity`) and in `byDay`.

**Where the data came from** (`meta`)
- **`source`**: `OPEN_METEO` (fetched just now) or `DATABASE` (served from storage).
- **`outdated: true`**: the data is older than the refresh interval, because a refresh was not possible.

**Errors** carry a stable `extensions.code` and a message that is safe to show to a user:

| Code | When | Extra |
|---|---|---|
| `LOCATION_NOT_FOUND` | no such city | |
| `BAD_USER_INPUT` | the name is too short, or the country code is malformed | |
| `CLIENT_RATE_LIMITED` | too many requests from one client | `retryAfterSeconds` |
| `OPEN_METEO_RATE_LIMITED` | Open-Meteo asked us to slow down and **nothing is stored** for this city | `retryAfterSeconds` |
| `OPEN_METEO_UNAVAILABLE` | Open-Meteo is down and **nothing is stored** for this city | `retryAfterSeconds` |

For a city that is already stored, an Open-Meteo problem is **not an error**: the old data is returned with `outdated: true`.

**Where the API is in the code.** GraphQL has no URL per operation (like REST): there is **one endpoint, `/graphql`**, and each operation is a method.
Everything is in one folder, [`src/api/graphql/`](src/api/graphql):
- the operations: [`ranking.resolver.ts`](src/api/graphql/ranking.resolver.ts) (each `@Query` is one);
- the shape of every answer: [`ranking.model.ts`](src/api/graphql/ranking.model.ts);
- the generated schema: [`schema.gql`](schema.gql).

More in [Project layout](#-project-layout).

## 🧮 How a score is calculated

The rules are meant to be simple enough to check by hand and fair: **every activity is judged by five conditions whose weights add up to 100.**

1. **Points.** A table (a **curve**) turns each measurement into a **mark** 0-100, e.g. rain: dry = 100, 1 mm = 62, 5 mm = 28, 10 mm = 8, straight lines in
   between. **Mark × weight**, added up: an ideal day gets 100, an acceptable one 60-70. A missing measurement is left out, neither rewarded nor punished.
2. **Ceilings.** A sum hides disasters (a downpour is one condition of five), so a bad enough condition (heavy rain, strong wind, freezing, fog, a flat
   sea, a thin snow base...) also sets a **ceiling** for the whole score.
3. **Dealbreakers** cap it (a fixed maximum): a thunderstorm, or gusts over 80 km/h, for outdoors; no snow at all (max 5) or rain on snow (max 45) for skiing.

| **Activity** | **Five conditions (weight %)** |
|---|---|
| ⛷️ **Skiing** | snow depth 40 · fresh snow 10 · temperature 25 · wind 15 · fog 10 |
| 🏄 **Surfing** | wave height 40 · swell period 20 · wind 20 · air temperature 10 · rain 10 (waves come from Open-Meteo's separate Marine API; inland cities have none, so surfing is "unavailable", not 0) |
| 🚶 **Outdoor sightseeing** | rain or snow 30 · felt temperature 35 · sky 15 · wind 10 · fog 10 |
| 🏛️ **Indoor sightseeing** | **derived**: **60** (always an option) + **40%** of the points outdoor weather loses, minus 15 in dangerous weather |

### Worked examples (outdoor and indoor sightseeing)

The final score is always the **smaller of two numbers: the points added up, and the lowest ceiling**
(a ceiling is the highest total score that one condition allows; "at most 18" means: the total cannot be more than 18).

#### Example 1: a grey, dry day

Dry, 12 °C (felt), fully overcast, 10 km/h wind, no fog.

| **Condition** | **Measured** | **Mark (0-100)** | **× Weight** | **= Points** | **Ceiling** |
|---|---|---|---|---|---|
| Rain | 0 mm | 100 | 30% | 30.0 | none |
| Temperature | 12 °C | 73.5 | 35% | 25.7 | at most 90 |
| Sky | 100% cloud | 25 | 15% | 3.8 | none |
| Wind | 10 km/h | 100 | 10% | 10.0 | none |
| Fog | none | 100 | 10% | 10.0 | none |
| **Points added up** | | | | **79.5** | |
| **Lowest ceiling** | | | | | **90** |
| **FINAL SCORE** = the smaller of 79.5 and 90, rounded | | | | **79 (GOOD)** | |

> ➜ **Outdoor result: 79 (GOOD).** The points add up to 79.5 and the only ceiling is 90, which is higher, so **the ceiling changes nothing** and the score stays 79.

**Indoor result: 68 (GOOD)** = 60 + 40% × (100 − 79).
Indoor sightseeing has no measurements of its own. It is always an option, so it starts at **60**, and the worse the weather is outside, the better it gets:
it adds **40% of the points that outdoor weather lost** (100 − 79 = 21 lost, 40% of that is 8.4). Both numbers (60 and 40%) are in `scoring-config.ts`.

#### Example 2: a downpour

12 mm of rain, 20 °C (felt), 60% cloud, 10 km/h wind, no fog.

| **Condition** | **Measured** | **Mark (0-100)** | **× Weight** | **= Points** | **Ceiling** |
|---|---|---|---|---|---|
| Rain | 12 mm | 6.4 | 30% | 1.9 | **at most 18** |
| Temperature | 20 °C | 100 | 35% | 35.0 | none |
| Sky | 60% cloud | 67.6 | 15% | 10.1 | none |
| Wind | 10 km/h | 100 | 10% | 10.0 | none |
| Fog | none | 100 | 10% | 10.0 | none |
| **Points added up** | | | | **67.1** | |
| **Lowest ceiling** | | | | | **18** |
| **FINAL SCORE** = the smaller of 67.1 and 18 | | | | **18 (POOR)** | |

> ➜ **Outdoor result: 18 (POOR), not 67.1.** The points add up to 67.1, but **rain allows at most 18**, and the final score is the smaller of the two.
> By points alone this day would get 67, which is absurd for a walk in a downpour (four of the five conditions are fine), so the ceiling wins.
> **The score can never be higher than the lowest ceiling.**

**Indoor result: 93 (GREAT)** = 60 + 40% × (100 − 18).
The outdoor weather lost 82 points, 40% of that is 32.8, on top of the base 60.

**The API returns exactly this table for every score**, as `breakdown`:
- `points` is the sum, and `limitedBy` says which ceiling cut it;
- the final result is the `score` next to it.

The test UI shows the same table as "Why N?" and ends it with a **Final score** line.

**Ratings:** 0-39 **POOR** · 40-59 **FAIR** · 60-79 **GOOD** · 80-100 **GREAT**.

**Where the numbers live and how they are kept honest**
- [`scoring-config.ts`](src/modules/scoring/config/scoring-config.ts): every number (curves, weights, ceilings, dealbreakers).
- [`SCORING.md`](src/modules/scoring/config/SCORING.md): the same numbers as plain tables. It is generated from the config by
  [`generate-scoring-docs.ts`](src/modules/scoring/config/generate-scoring-docs.ts); a test fails if it is out of date, and `npm run docs:scoring` refreshes it.
- [`scoring.calibration.spec.ts`](src/modules/scoring/scoring.calibration.spec.ts): a table of typical days with the range each must fall into,
  so a change that makes a typical day come out silly fails a test.

## 🔄 How it works

```
request ─► per-client limit (Redis) ─► find the city (Postgres; geocode once, remember the name)
                                          │
              stored data younger than 6 h? ─yes─► read from Postgres ─┐
                          │ no                                         │
              take a lock (Redis): ONE request refreshes               ▼
                          │                                   score every day and activity
              call Open-Meteo (+ waves for coastal cities)       (pure rules, nothing stored)
                          │                                            │
              store 7 days in Postgres ────────────────────────────────┘
              failed / "too many requests"? ─► pause calls (all instances), serve stored data
                                                marked outdated, or a clear error for a new city
```

- **Storage** ([`prisma/schema.prisma`](prisma/schema.prisma)): `Location` (one row per real place, keyed by the geocoder's id, so "Munich" and
  "Munchen" are one row), `LocationAlias` (what users typed, so a repeated name never calls the geocoder), `DailyWeather` (7 normalized days per place),
  `FetchState` (when it may be refreshed again). Scores are computed on read, so changing a rule never leaves old numbers behind.
- **Refresh**: data is reused for 6 hours; ten simultaneous requests for a stale city make one Open-Meteo call (tested).
- **Redis** holds only **disposable data, always with an expiry**: client counters, the refresh lock, the Open-Meteo pause. Memory-limited with
  `volatile-lru`; if Redis is down the service keeps working with in-memory fallbacks.
- **Open-Meteo quota** (details in [`docs/research`](docs/research/open-meteo-findings.md)):
  - the free tier allows **10,000 calls/day**;
  - a city costs about 6-10 calls per day at a 6-hour refresh, so the quota holds roughly **800-1,700 cities** refreshed daily;
  - the cost is per location, so batching cities saves round trips, not quota.
- **Layers**: **api** (GraphQL, /health) → **service** (rules, in `modules`) → **repository** (only Prisma) / **client** (only Open-Meteo), both in `infrastructure`; scoring is pure. Rules in [`AGENTS.md`](AGENTS.md).

## 📌 Assumptions and limitations

The full list, as question → assumption → what changes otherwise, is in [`docs/QUESTIONS.md`](docs/QUESTIONS.md). The main ones:

- **What "rank" means.** The brief can be read two ways, so the API gives both:
  - the four activities ordered from best to worst for the coming week, by their 7-day average score (`byActivity`);
  - the 7 days ordered from best to worst inside each activity (`rank` in `days`).
- **A name that exists in several places** ("Paris" is in France and in Texas). The geocoder's top match is used and the response says which place it is (`location`).
  To get another one, pass a `countryCode` (e.g. `US`), or look first with `searchLocations`.
- **Scores are rules of thumb.** The thresholds are my own simple, explainable choices, not calibrated against real data and not a meteorological model.
- **No login.** A client is its `x-api-key` header if sent, otherwise its IP address; each may send **60 requests per minute**.
- **Skiing is judged at the town, not at the slopes.** Weather is taken at the town's coordinates, so a ski town in a valley without snow scores low even if the slopes above are white. Finding nearby resorts is future work.
- **Language of the city name.** A name typed in Cyrillic is searched in Russian, anything else in English. Ukrainian-only or Belarusian-only spellings are not recognised.
- **Open-Meteo's answer is stored in our own columns, not as raw JSON.** If Open-Meteo changes its format, one file (the mapper, covered by tests) and maybe the database schema must change.
  Raw JSON would tolerate that better, but is harder to query and to validate.
- **Old data is not cleaned up automatically.** Every city that was looked up is kept (about 2 KB each), and a city nobody asks for any more keeps its last forecast.

## 🚧 What I cut, and why

- **Usage counters for the Open-Meteo allowance**: reacting to its `429` with one shared pause is much simpler, and the 6-hour interval keeps usage far below the limits.
- **Weather in Redis instead of Postgres.** Two problems:
  - A Redis key expires after 6 hours and is deleted. If Open-Meteo cannot be reached right then, there is nothing left to show; in Postgres the old forecast stays and is served marked `outdated`.
  - Redis is memory-limited and not persisted, so a restart would lose every forecast and trigger a burst of Open-Meteo calls.
- **A Redis cache in front of Postgres**: a lookup by key in Postgres takes about a millisecond, so it would add a second copy of the data and rules for when to drop it, for no visible gain.
- **Background refresh of popular cities, batching, nearby ski resorts, forecast history, scheduled cleanup**: listed in
  [`design.md`](openspec/changes/build-weather-activity-ranking/design.md) under *Future Improvements*.
- **Authentication**: out of scope; clients are anonymous and rate limited.
- **The per-client limit lives in Redis, slightly more than one instance needs.**
  - Memory counters would do for one instance (they are the fallback), and nginx `limit_req` is the usual tool for per-IP limits.
  - Redis stays because it is already there for the lock and the pause, it works across instances, and it can limit per `x-api-key`.
  - Edge limiting by nginx or a CDN is a possible later step.
- **Prisma 7 and NestJS 12** (ESM-only): worthwhile upgrades, not worth the risk here.

## 🔧 Configuration

Environment variables only, validated at start-up (a bad value stops the service with a message naming it). Defaults live in
[`src/config/app-config.ts`](src/config/app-config.ts).

| **Environment** | **Values come from** |
|---|---|
| Docker demo (`npm run up`) | `environment:` of the `app` service in [`docker-compose.yml`](docker-compose.yml) |
| Dev (app from source, Postgres and Redis in Docker) | [`.env.dev`](.env.dev), committed (throw-away local passwords) |
| Tests | the `tests` service in `docker-compose.yml` (own schema and Redis db) |
| Production | not set up: the platform provides real variables; leave `GRAPHQL_SANDBOX` and `UI_ENABLED` unset (off) |

More environments: **one file per environment**, `.env.<name>`, plus a `start:<name>` script that loads it. **Only `.env.dev` exists**; other `.env.*` files are git-ignored on purpose (secrets).

| **Variable** | **Default** | **Meaning** |
|---|---|---|
| `PORT` · `DATABASE_URL` (required) · `REDIS_URL` | 3000 · – · `redis://localhost:6379/0` | the port the service listens on (inside Docker always 3000; the port you open is `APP_PORT`); empty `REDIS_URL` disables Redis (in-memory fallback) |
| `APP_PORT` / `POSTGRES_PORT` / `REDIS_PORT` | 4747 / 54329 / 63799 | host ports published by `docker-compose.yml` (read by Compose; the service only gets `APP_PORT` as `PUBLIC_PORT`, to print the right address at start-up) |
| `FORECAST_TTL_HOURS` | 6 | minimum time between refreshes of one city |
| `CLIENT_RATE_LIMIT` / `CLIENT_RATE_WINDOW_SECONDS` | 60 / 60 | requests per client per window |
| `UPSTREAM_PAUSE_MINUTES` | 15 | pause after Open-Meteo's `429` without a retry time |
| `LOCK_POLL_MS` / `LOCK_WAIT_MS` / `LOCK_TTL_MS` | 500 / 10000 / 30000 | refresh lock: check interval, give-up time, lifetime if its holder crashes |
| `OPEN_METEO_*_URL`, `OPEN_METEO_TIMEOUT_MS` | public URLs, 8000 | point at a mock or a paid plan |
| `GRAPHQL_SANDBOX` / `UI_ENABLED` | `false` (demo: `true`) | Apollo Sandbox + introspection / the test UI |

## 📁 Project layout

**In one minute.** A request goes through **three layers**, and each layer only calls the one below it:

```
request ─► src/api  ─────────► src/modules  ─────────► src/infrastructure
           the entry points     the business logic       the outside world
           (GraphQL, /health)   (rules, scoring, rules    (database, Open-Meteo, Redis)
                                for refreshing data)
```
`src/modules` never imports from `src/api`, and `src/infrastructure` never imports from `src/modules`, so each part can be read, tested and changed on its own.

**Where do I find...?**

| **I am looking for** | **It is in** |
|---|---|
| the API: which operations exist (`activityRanking`, `searchLocations`) | [`src/api/graphql/ranking.resolver.ts`](src/api/graphql/ranking.resolver.ts) |
| the shape of every answer, and the generated schema | [`ranking.model.ts`](src/api/graphql/ranking.model.ts) in the same folder, and [`schema.gql`](schema.gql) |
| GraphQL settings, Sandbox on/off, the rate limit, the error log | the rest of [`src/api/graphql/`](src/api/graphql) |
| `GET /health` (the only REST route) | [`src/api/health/`](src/api/health) |
| how a score is calculated; all the numbers | `src/modules/scoring/` (`engine/` the maths, `config/` the numbers, `scorers/` one per activity) |
| how a city name is turned into a place (the rules) | `src/modules/locations/` |
| the 6-hour refresh, the lock, the "outdated" fallback (the rules) | `src/modules/forecast/` |
| putting it together for one request | `src/modules/ranking/ranking.service.ts` |
| calls to Open-Meteo, the pause after a 429 | `src/infrastructure/open-meteo/` |
| **All database code**: the connection and the repositories (the only code that reads and writes the tables) | [`src/infrastructure/database/`](src/infrastructure/database); the tables are in [`prisma/schema.prisma`](prisma/schema.prisma) |
| Redis (rate-limit counters, locks, the pause) | `src/infrastructure/redis/` |
| settings and environment variables | `src/config/app-config.ts`, [`.env.dev`](.env.dev) |
| the clock and the error types used everywhere | `src/common/`; plain shared types in `src/domain/` |

```
src/
  api/                  LAYER 1, the entry points (how the outside talks to us)
    graphql/              the GraphQL API: operations, answer shapes, settings, rate limit, error log, Sandbox examples
    health/               GET /health
    api.module.ts
  modules/              LAYER 2, the business logic (no GraphQL, no HTTP, no SQL)
    ranking/              puts one request together
    locations/            city name -> place
    forecast/             the 6-hour refresh, lock, "outdated" fallback
    scoring/              the scores (engine/ maths · config/ numbers · scorers/ one per activity)
  infrastructure/       LAYER 3, the outside world (one folder per thing)
    database/             Postgres: the connection and ALL repositories
    redis/                Redis: counters, locks, the pause
    open-meteo/           Open-Meteo: HTTP client, response mapper, the pause after a 429
  config/               settings from environment variables
  common/ · domain/     clock and error types · plain shared types
  main.ts · bootstrap.ts · app.module.ts    start-up
test/                integration + end-to-end tests, recorded Open-Meteo responses, fakes
prisma/              schema and migrations (see prisma/README.md)
docs/                decisions, open questions, API research
openspec/            the plan: proposal, design, specs, tasks
public/              the test UI (one static page)
schema.gql           the GraphQL schema, generated from the code on every start
```

**NestJS words used here:** a **module** groups related classes; a **service** holds logic; a **resolver** is where GraphQL operations are
declared (a **controller** is the same for REST); a **guard** runs before an operation (here: the rate limit); a **filter** handles errors.
The rules for adding code are in [`AGENTS.md`](AGENTS.md).

## 💻 Test UI (extra, not part of the assignment)

The brief says "backend only, don't build a front end". I read that, and still added **one small page for my own testing**.
It is a quick **test page, not a polished front end** (the page itself says "TEST UI"), and I did not spend much time on it.

**Why I added it:** it shows the week at a glance and the "why this score" table faster than Apollo Sandbox does.

**What it does**
- Type a city: the best match shows at once, other places with that name appear as chips you can click.
- Today is selected by default; click any day to see each activity's score and the "Why N?" table.
- Light theme by default, a switch for dark in the corner.

**How it is kept out of the way**
- One static file, `public/index.html`: Vue 3 and Tailwind without a build step, the libraries copied next to it.
- It only calls the public GraphQL API, like any other client.
- Off unless `UI_ENABLED=true` (the compose file sets it for the demo).
- Deleting the `public/` folder removes it completely.

---

Built by **Siarhei Bokuts** as a take-home exercise. `UNLICENSED`. Weather data © [Open-Meteo](https://open-meteo.com), free non-commercial terms (CC BY 4.0).
