# Tasks

Each group ends with a "done when" line: the observable check that closes it. Commit after every group; keep commits small.

## 1. Project skeleton and Docker

- [x] 1.1 Scaffold the NestJS TypeScript project; ESLint, Prettier, strict TypeScript
- [x] 1.2 Config module with validated env: refresh TTL, client limit and window, `UPSTREAM_PAUSE_MINUTES`, `MAX_STORED_LOCATIONS` (default 1000), URLs
- [x] 1.3 Injectable `Clock` so time is never read directly in services
- [x] 1.4 Prisma schema `Location` (with `lastRequestedAt`, cascade delete to weather and fetch state), `DailyWeather` (unique location + date), `FetchState`, and the first migration
- [x] 1.5 Shared Redis module (ioredis) with a safe wrapper that reports failures instead of throwing and only offers "set with TTL" so no key lacks an expiry
- [x] 1.6 Health endpoint for database and Redis
- [x] 1.7 Multi-stage `Dockerfile`; `docker-compose.yml` with app, postgres, redis (health-checked; `--maxmemory 64mb --maxmemory-policy volatile-lru --save "" --appendonly no`), migrate on start

Done when: `docker compose up --build` starts the stack and the health endpoint reports healthy.

## 2. Open-Meteo client

- [x] 2.1 Geocoding call (up to 5 matches with population, elevation, time zone, feature code, optional `countryCode`); empty or missing `results` means no match
- [x] 2.2 Forecast call: only the daily fields the scorers use plus hourly snow depth (cost grows with variable count), local time zone
- [x] 2.3 Marine call; all-null response maps to "no wave data"
- [x] 2.4 Normalizer to one internal daily shape (km/h, mm, cm, seconds); hourly snow depth to daily maximum
- [x] 2.5 Timeouts, one retry on network errors, mapping of HTTP 429 to a typed error that carries the retry time when the headers give one
- [x] 2.6 Reuse the samples in `docs/research/samples/` and record the missing ones as fixtures: Innsbruck, Munich (inland marine), Biarritz (coastal marine), a 429 sample, and geocoding samples for Paris (several countries), Zermatt (airport entry) and a no-match name

Done when: contract tests pass against the fixtures with no network.

## 3. Upstream pause on 429

- [x] 3.1 `UpstreamGate`: store `upstream:blocked_until` in Redis after a 429 (header time, else `UPSTREAM_PAUSE_MINUTES`, default 15), key expires on its own
- [x] 3.2 Client checks the gate before every call and throws `OpenMeteoRateLimited` with `retryAfterSeconds`, making no network call while paused
- [x] 3.3 In-memory fallback with a warning when Redis is unavailable

Done when: tests prove no upstream call is made while paused, the retry seconds are right, and calls resume after the time passes.

## 4. Locations and forecast refresh

- [x] 4.1 Locations service: reject input under 2 characters, keep only populated places (`PPL*`), take the first match, honour `countryCode`, persist keyed by the geocoder id so alternate spellings share a row, reuse without geocoding again
- [x] 4.2 Forecast service: read-through with TTL (default 6 hours), double-checked Redis lock, transactional upsert, delete past days
- [x] 4.3 Resolution order: fresh data, else upstream (unless paused), else stale data, else typed error
- [x] 4.4 `marineAvailable` recorded on the first marine fetch; later refreshes skip marine when false
- [x] 4.5 In-process lock fallback with a warning when Redis is unavailable
- [x] 4.6 `FetchState` records success time, expiry and last error
- [x] 4.7 Bounded storage: update `lastRequestedAt` at most hourly; on inserting a location beyond `MAX_STORED_LOCATIONS`, delete the least recently requested one in the same transaction

Done when: ten concurrent requests for one expired location produce exactly one upstream forecast call.

## 5. Scoring

- [x] 5.1 Scoring config: thresholds, penalties, rating bands (POOR 0-39, FAIR 40-59, GOOD 60-79, GREAT 80-100), summary templates
- [x] 5.2 Outdoor sightseeing scorer with reasons and severe-weather cap
- [x] 5.3 Indoor sightseeing scorer (base value, bonus in bad weather, small penalty only for severe weather)
- [x] 5.4 Skiing scorer (no snow gives a very low score and says so) and surfing scorer (unavailable without wave data)
- [x] 5.5 Summary builder: one sentence per day and activity, from the strongest reasons
- [x] 5.6 Aggregation: weekly average, best day, daily rank, activities ordered by average, and the per-day view with the best activity of each day

Done when: the scoring module has no I/O and 100% coverage.

## 6. GraphQL API, limits and errors

- [x] 6.1 `activityRanking(city, countryCode)` returning location, `byActivity`, `byDay` and `meta`; `searchLocations(query)`; commit the generated `schema.gql`
- [x] 6.2 Field descriptions and example queries in the schema so Sandbox documents itself
- [x] 6.3 Typed errors with stable codes: `LOCATION_NOT_FOUND`, `CLIENT_RATE_LIMITED`, `OPEN_METEO_RATE_LIMITED`, `OPEN_METEO_UNAVAILABLE`; friendly messages with a rounded wait
- [x] 6.4 Client rate limit by `x-api-key` or IP, Redis-backed, working in the GraphQL context, with retry-after and in-memory fallback
- [x] 6.5 Enable Apollo Sandbox at `/graphql` also under `NODE_ENV=production`
- [x] 6.6 Input validation and a maximum for the number of search results

Done when: Sandbox opens at `http://localhost:3000/graphql` and a ranking query returns both views and `meta.source`.

## 7. Tests (coverage is part of the deliverable)

- [x] 7.1 Unit: every scorer (rain, wind, heat, cold, no snow, fresh snow, inland surfing, indoor inversion, band edges) and the summary builder
- [x] 7.2 Unit: upstream gate (pause after 429, header time vs default, expiry, Redis down) and Redis wrapper (always sets a TTL)
- [x] 7.2b Integration: location cap evicts the least recently requested city with its weather rows; Redis under a tiny `maxmemory` still accepts writes
- [x] 7.3 Service: refresh logic with a fake provider and fake clock (fresh, expired, concurrent, stale on error, no data on error, quota exhausted with and without stored data)
- [x] 7.4 Contract: Open-Meteo client and normalizer against fixtures
- [x] 7.5 E2E over HTTP against real Postgres and Redis with Open-Meteo mocked: first call `OPEN_METEO`, repeat `DATABASE`, unknown city, inland surfing unavailable, client limit exceeded, quota-exhausted error for a new city and stale answer for a known one
- [x] 7.6 Jest coverage thresholds enforced (90% lines and branches overall, 100% for scoring); lint and format checks run in the same command
- [x] 7.7 `tests` compose service: `docker compose run --rm tests` runs lint, tests and coverage, and exits non-zero on failure

Done when: one command runs everything green from a clean clone.

## 8. Documentation and extras

- [x] 8.1 Postman collection: first fetch, repeat fetch, location search, inland city, forced error examples
- [x] 8.2 README: what it does, run and test commands, Sandbox, example query and response, assumptions, known limitations (city is not the slopes, ambiguous names, free-tier limits), what was cut and why, a note that the service copes with Open-Meteo limits, and a "Future work" section: batching several cities per request (measured: cost is per location, so it saves round trips, not quota), usage counters, background refresh, nearby ski resorts
- [x] 8.3 `docs/DECISIONS.md` and `docs/QUESTIONS.md` (question for product, assumption taken)
- [x] 8.4 Process notes: `docs/DECISIONS.md` records what was chosen, rejected and why

Done when: a reviewer can follow the README from clone to a working query without help.
