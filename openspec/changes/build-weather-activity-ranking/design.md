# Design

## Context

Greenfield repo (only a README). Stack is fixed by the exercise and the author: Node.js, GraphQL, NestJS, TypeScript, Postgres, Redis, Docker. See proposal.md for motivation.

Facts checked against the live Open-Meteo API while planning (they shape the design):

- Free tier: 600 calls/min, 5,000/hour, 10,000/day, 300,000/month, non-commercial only. Responses carry `X-RateLimit-*` headers.
- Geocoding returns several matches for a name (for example three "Paris"), ordered by population, with elevation and time zone.
- The forecast `daily` block has temperature, precipitation, snowfall, wind, gusts, weather code, sunshine and UV. Snow depth exists only as `hourly` (168 values for 7 days).
- The marine API answers HTTP 200 with all-null arrays for inland points (Munich) and snaps to the nearest sea point for coastal ones. It is a separate host from the forecast API.
- Wind speed is in km/h and sunshine duration in seconds.

## Goals / Non-Goals

**Goals:**
- Simple, readable modules with one job each; the scoring rules isolated and trivially testable.
- Refresh that is correct under concurrency and respects an upstream "too many requests" answer.
- A reviewer can run, test and poke the service with Docker alone.

**Non-Goals:**
- Batching several cities into one Open-Meteo request: version one fetches one location per call, driven by one user request (see Future Improvements).
- Authentication or accounts; per-country limits; a response cache layer; background refresh jobs; negative caching of failed geocoding; locating nearby ski resorts; any frontend.
- Meteorological accuracy. Scores are explainable heuristics, not forecasts of skill.

## Decisions

### D1. NestJS + Apollo (code-first) + Prisma + Postgres
Nest gives modules, DI, guards and testing utilities that map onto the layers below. Code-first GraphQL with the generated `schema.gql` committed keeps schema and types in one place and readable without running the app. Prisma is chosen for readable schema, one-command migrations and generated types.
Alternatives: schema-first SDL (more boilerplate for types), TypeORM (more idiomatic in Nest but noisier), SQLite (no Docker needed, but Redis already requires Docker, so Postgres costs nothing extra).

### D2. Postgres is the source of truth; weather stored normalized, scores computed on read
Tables: `Location`, `DailyWeather` (unique on location + local date), `FetchState` (one record per location: fetched at, expires at, last error). Scores are not stored because the rules will change and computing 28 scores is trivial.
Alternative: store raw JSON (flexible but unqueryable and ties storage to the upstream shape).

### D3. Refresh: read-through with TTL, default 6 hours, configurable
`FORECAST_TTL_HOURS` (default 6). Open-Meteo models update every 1 to 6 hours, so 6 hours loses little freshness and saves quota. Rough budget: our forecast request costs about 1.4 units (measured through the `X-RateLimit-Cost` header; see Open Questions), 4 refreshes/day/location is about 6 units/day/location for the forecast, so the 10,000/day allowance keeps well over a thousand locations refreshed daily. The marine (wave) API reports no cost, but Open-Meteo's terms apply limits per IP and define a call as roughly one HTTP request, so we assume it counts like a forecast call (about 1 unit, measured only as an assumption): a refresh then costs up to ~2.4 units and about 800 locations fit.

### D4. Single-flight via a Redis lock per location
`SET key NX PX` lock around the refresh; the winner re-checks the database (double-check), fetches, writes in a transaction, releases. Losers wait briefly (checking every `LOCK_POLL_MS`, 0.5 s by default, for up to `LOCK_WAIT_MS`) then read the database or fall back to outdated data. If Redis is down, fall back to an in-process lock with a logged warning.
Alternative: in-process promise map only (breaks with more than one instance).

### D5. Outdated-data fallback
If the upstream call fails and rows exist, serve them with `outdated: true`. No rows: a typed error with a retry hint.

### D6. Marine only when it can return something
First marine fetch for a location records `marineAvailable` (true if any non-null value). When false, later refreshes skip the marine call. That certainly saves one HTTP round trip (latency and one more thing that can fail) per refresh of an inland city, and saves about 1 unit of quota per refresh on the cautious assumption (see above) that marine calls count like any other call. Surfing is then `available: false`.

### D7. Per-client rate limit: a small custom guard counting in Redis
One limit per client key (`x-api-key` header, else IP), shared across instances through Redis. GraphQL needs the guard to read the request from the GraphQL context. Limits and window come from env. On Redis failure, fall back to in-memory counters with a warning. A custom guard (about 20 lines) was preferred to the Nest throttler package, which needs extra work to read a GraphQL request, and a guard that is fully unit-tested is easy to reason about.
Alternative considered and cut: a separate, stricter client limit for requests that miss the cache. The upstream pause in D13 covers the same risk more simply.

### D8. Scoring: points for good conditions, ceilings for bad ones
`ActivityScorer` takes one day of weather and returns `{ score, reasons[] }` per activity; scorers are pure and share one small engine (`model.ts`). Every activity is judged by exactly five conditions whose weights add up to 100 (a test enforces it), so no activity is judged more or less strictly than another. Each condition maps a measurement to a 0-100 mark through a table (a curve); marks times weights are added up (a weighted average, missing data left out). A condition can also set a ceiling for the whole score (heavy rain, strong wind, freezing, fog, a flat sea, thin snow), and dealbreakers cap it (thunderstorm, no snow, rain on snow). Indoor sightseeing is derived: 60 plus 40% of the points outdoor weather loses, minus 15 in dangerous weather.
Alternatives tried on the same typical days: (a) start at 100 and subtract penalties: every day without a visible problem scored about 100, so outdoor beat indoor on every dry day; (b) a weighted geometric mean (one bad factor drags the result down without ceilings): fair, but much harder to explain than adding points. Points plus ceilings gave the same sensible results as (b) once freezing, heat and fog got ceilings, and can be checked by hand.
The curves and weights are pinned by a table of typical days with expected ranges (`scoring.calibration.spec.ts`).

Rating bands: 0-39 POOR, 40-59 FAIR, 60-79 GOOD, 80-100 GREAT. Week score is the mean of daily scores; `bestDay` is the max.

### D9. Response shape and metadata
One computed matrix (7 days x activities, each cell `{ score, rating, summary, reasons[] }`) feeds two views, so there is no duplicated logic:
- `byActivity`: ordered by weekly average, with `bestDay` and daily ranks.
- `byDay`: for each date, every available activity's cell and `bestActivity`.
`meta { source: OPEN_METEO | DATABASE, fetchedAt, nextRefreshAt, outdated }`. A Redis-level response cache is not built, so there is no third source value.

The `summary` sentence is built from the scorer's reasons: the most important negative or positive reason for that activity plus a short verdict ("Rainy, not great for walking around" / "Good day for museums and indoor plans"). Templates live next to the thresholds in the scoring config so wording and rules change together.

### D13. Upstream pause on 429 (no counters)
One Redis key, `upstream:blocked_until`, written by a tiny `UpstreamGate`:
- When Open-Meteo answers 429, store the resume time: from `Retry-After` or `X-RateLimit-Reset` when present, otherwise now + `UPSTREAM_PAUSE_MINUTES` (default 15). The key expires on its own at that time.
- Before each upstream call the client asks the gate; if paused it throws `OpenMeteoRateLimited` with `retryAfterSeconds` without any network call.
- The pause is in Redis, so every instance honours it. If Redis is down the gate falls back to an in-memory value with a warning.
- The cost is one wasted request when the limit is first hit. Alternative considered: per-minute/hour/day counters (avoids that request and shows remaining allowance) - cut as unnecessary for this scope because the 6-hour refresh interval keeps usage far below the free-tier limits; named in the README as a next step.

### D14. Error model
Four typed GraphQL errors with stable `extensions.code`: `LOCATION_NOT_FOUND`, `CLIENT_RATE_LIMITED`, `OPEN_METEO_RATE_LIMITED`, `OPEN_METEO_UNAVAILABLE`. Each has a user-safe message and, where it makes sense, `extensions.retryAfterSeconds`. The quota message is rendered with a rounded wait ("about 15 minutes"). Resolution order for a refresh: fresh data wins; else try upstream; on quota/failure serve outdated if any; else the typed error.

### D15. Code structure and quality bar
Layered and dependency-injected so each unit is testable in isolation: resolvers only translate; services hold the rules; repositories are the only code that touches the database; the Open-Meteo client is the only code that calls Open-Meteo; the clock, Redis and both of those are injected and replaced in tests. The clock is an injected dependency, not `Date.now()` calls scattered around. Jest coverage is enforced (overall 90% of lines and 85% of branches; scoring 100% of lines and 95% of branches); the test run fails below the threshold. ESLint and Prettier are configured and run in the `tests` container.

### D16. Location resolution (checked against the live geocoding API)
Observed behaviour: results are relevance-ranked (population-weighted); the optional `countryCode` filter (ISO alpha-2) works; Cyrillic and alternate spellings resolve ("Минск" gives Minsk BY, "Munchen" gives Munich); partial input matches by prefix ("Lond" gives London); a single character and gibberish return an empty result with no `results` field rather than an error; results include non-city features (an airport next to Zermatt, tiny hamlets).
Decisions:
- Ask for up to 5 matches, keep only populated places (feature code `PPL*`), take the first one. "Best match" therefore means what the geocoder ranks first among real towns and cities.
- Pass `countryCode` through when the client supplies it. `searchLocations` returns the candidate list so a client can pick one.
- Input shorter than 2 characters is rejected before any upstream call; a missing `results` field maps to `LOCATION_NOT_FOUND`.
- The response always includes the chosen location (name, region, country), so a wrong guess is visible.
- The geocoder's own id is the unique key of a stored `Location`, so alternate spellings of one place share one row and one refresh.
- The geocoding language follows the alphabet of the typed name (Cyrillic: Russian, otherwise English), because the geocoder only matches a name in the language it answers in ("Минск" finds Minsk only with `ru`). Ukrainian or Belarusian-only spellings are not recognised. A stored place keeps the name it was first found under; storing coordinates, time zone and id means later requests never depend on spelling.

### D17. Redis holds only disposable data; automatic expiry first, memory limit as a safety net
Everything in Redis is short-lived: client limit counters (TTL = window), per-location refresh locks (TTL ~30 s) and the `upstream:blocked_until` pause (TTL until it ends). Cities and weather are **not** stored in Redis.
- **Primary mechanism: TTL on every key.** A small Redis wrapper only offers "set with TTL", so a key without expiry cannot be written by accident.
- **Safety net: `maxmemory` with `volatile-lru`** (compose default 64 MB), persistence off (`--save "" --appendonly no`) because nothing needs to survive a restart. When memory is full, Redis evicts the least-recently-used keys that have a TTL.
- **Do not use `noeviction`.** Verified on the real image: with a 3 MB limit, 40,000 writes under `volatile-lru` all succeeded (31,792 old keys evicted, 0 errors, a key without TTL survived, TTL expiry worked), while under `noeviction` 31,395 of 40,000 writes failed with OOM errors. Failing writes would break the rate limiter.
- If an evicted key was a limit counter, that client simply gets a fresh window; if it was a lock, the next request re-checks the database. Both degrade safely.

### D18. No cap on stored cities
Every resolved city is kept. A first version capped the count (deleting the least recently requested city) but a cap does not help here: Postgres is indifferent to thousands of ~2 KB cities, storing a city costs no Open-Meteo quota (refreshing does), and evicting a city that is later asked for again wastes quota re-fetching it. `Location.lastRequestedAt` (updated at most hourly) is recorded so a future cleanup by age (see Future Improvements) has the data it needs.

### D10. Apollo Sandbox behind one switch, off by default
Apollo's own default (Sandbox and introspection on in development, off in production, read from `NODE_ENV`) does not fit a service that is meant to be started in a production-mode Docker container for review. So one explicit setting, `GRAPHQL_SANDBOX`, controls both the Sandbox page and schema introspection: off by default (what a real production deployment should use), on in `docker-compose.yml` for the demo. The page loads its UI from Apollo's CDN, so it needs internet access; the service itself does not. Both modes are covered by end-to-end tests.

### D11. Docker and tests
Multi-stage `Dockerfile`; `docker-compose.yml` with `app`, `postgres`, `redis` (health-checked) and a `tests` service under a profile. App container applies Prisma migrations on start. Tests: unit (scorer, freshness logic), service-level (refresh with a fake provider), e2e (GraphQL over HTTP against real Postgres/Redis with Open-Meteo mocked using recorded real responses for Innsbruck, Munich and Biarritz). Postman collection lives in `postman/`.

### D12. Layers and folders
Handler (resolver, controller, guard) -> service (rules) -> repository (database) / client (Open-Meteo) / Redis; scoring is pure rules. Folders: `config/`, `common/` (clock, typed errors, guards), `domain/` (shared plain types), `infrastructure/{open-meteo,prisma,redis}` (one folder per outside thing), `modules/{locations,forecast,scoring,ranking,health}` (features). Dependencies point inward: modules may use infrastructure, domain and common; infrastructure and common never import modules. The full rules are in `AGENTS.md`.

## Risks / Trade-offs

- [Snow at the city does not equal snow at ski resorts] -> documented limitation; skiing reflects the geocoded point only.
- [Ambiguous names resolve to the best-ranked town or city] -> response shows the chosen location; country code parameter and `searchLocations` available.
- [Free tier is non-commercial and has no uptime guarantee] -> outdated fallback; README notes it.
- [Redis outage weakens limits and locks] -> degrade to in-process behaviour with warnings instead of failing requests.
- [Heuristic scores are subjective] -> reasons are returned with every score and all thresholds are in one config.
- [Sandbox needs CDN access, and is off unless GRAPHQL_SANDBOX is set] -> README notes both; the compose file turns it on; Postman collection is the offline alternative.
- [The first rejection costs one wasted upstream request] -> accepted; the pause then protects all later requests and all instances.
- [A burst of many distinct new cities can still exhaust the allowance] -> those users get the clear `OPEN_METEO_RATE_LIMITED` error with a retry time while known cities keep working from stored data.
- [We transform Open-Meteo's response into our own columns, so a change in its format means changing our code and our database] -> The transformation lives in one place (`open-meteo.mapper.ts`) and is pinned by contract tests on recorded real responses, so a format change fails a test instead of silently corrupting data. Removing or renaming a field only touches the mapper; adding a new field also needs a database migration. *Alternative considered:* store the raw response as JSON (a `jsonb` column) and parse on read. That is simpler to store and survives format changes without a migration, but the scorers still need the parsed shape (so the mapper moves, it does not disappear), values become harder to query and validate, and a malformed response would be stored instead of rejected. We chose columns for now; switching to raw JSON is a reasonable later simplification if the format proves unstable.

## Open Questions

- Exact numeric defaults for the client limit (starting point: 60 requests/minute) can be tuned during implementation without changing the specs.
- **Why Postgres if Redis exists? Could weather live only in Redis with a TTL, or should Redis sit in front of the database?** Three options were weighed:
  1. *Redis only* (weather JSON with a 6-hour TTL, no database). Simplest, and expiry is automatic. Rejected because Redis is disposable here (memory limit with eviction, no persistence): a restart or eviction would turn every city into a fresh Open-Meteo call at once, spending quota, and **the old data is gone just when it could still help**: when Open-Meteo is down or rate-limiting right after the 6 hours are up, the slightly old forecast is the best answer we have, but the TTL has already deleted it. In Postgres it stays and is served marked `outdated`. The brief also asks for data to be persisted.
  2. *Redis in front of Postgres* (read-through cache: Redis, then Postgres, then Open-Meteo). Faster reads, but a Postgres lookup by primary key already takes about a millisecond, so the gain is not visible, while it adds a second copy of the data and the question of when to invalidate it. Not built; listed as future work.
  3. *Postgres as the store, Redis for coordination* (what is built). Lookup order is always **Postgres first**; Open-Meteo is called only when the stored data is older than 6 hours (or missing), and never "instead of" looking at Postgres. Redis holds only what must be shared and short-lived: client counters, the one-refresh-at-a-time lock, and the Open-Meteo pause.
  Revisit option 2 only if measurements show database reads are the bottleneck.
- Can batching several cities into one Open-Meteo request save quota? Checked against the live API (response header `X-RateLimit-Cost`): **no for quota, only for round trips.** One location costs 1.0 and 3 locations cost 3.0 and 10 locations cost 10.0, so the cost is per location, not per request. Cost also grows with request size: 4 daily variables plus hourly snow depth for 7 days is 1.0, while 12 daily variables plus 2 hourly ones is 1.4; 16 days instead of 7 did not change it for a single variable. The marine API did not return a cost header, so its weight is unmeasured. Consequences: the real savings are fewer variables per request (request only fields the scorers use), the 6-hour refresh interval, and skipping marine for inland cities. Batching would still cut HTTP overhead for a future background refresh job, so it is kept as a follow-up and described in the README, not built now.

## Future Improvements

Not part of version one; each is described in the README so the reasoning is visible.

- **Batch several cities per Open-Meteo request.** Version one makes one call per location, triggered by one user request. Measured cost is per location, so batching saves round trips, not quota; it becomes useful with a background refresh job.
- **Cleaning the database.** Today nothing deletes old data on a schedule. What does limit it: a refresh replaces all of a city's days (so past days of cities that are being asked about disappear), and the number of cities is capped (the least recently requested one goes first). What is left behind: cities nobody asks about any more keep their last stored days (outdated and in the past) until the cap pushes them out. A background cleanup would delete days in the past, and cities not requested for N days, on a schedule; the data is time-based (it expires with the dates), so cleaning by date is safe. Not built: the cap already bounds the size.
- **Redis read-through cache in front of Postgres**, only if measurements show database reads matter (see the open question above).
- **Usage counters** (minute, hour, day) to avoid the one wasted request when the allowance is first exceeded and to show remaining allowance.
- **Background refresh** of popular locations so users rarely wait for an upstream call.
- **Nearby ski resorts** instead of the city point, since snow in a city does not reflect the slopes; optionally request the forecast at slope elevation.
- **Edge rate limiting.** Let a reverse proxy or CDN (nginx `limit_req`) do coarse per-IP limiting and keep the Redis limit for API keys; the service must then trust `X-Forwarded-For` (Express `trust proxy`) or every client looks like the proxy.
- **Stricter limit for requests that need an upstream call** than for cached ones.
- **History of forecasts** (where a time-series store such as TimescaleDB would make sense) to compare predictions with reality.
