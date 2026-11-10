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
Tables: `Location`, `DailyWeather` (unique on location + local date), `FetchState` (per location and source: fetched at, expires at, last error). Scores are not stored because the rules will change and computing 28 scores is trivial.
Alternative: store raw JSON (flexible but unqueryable and ties storage to the upstream shape).

### D3. Refresh: read-through with TTL, default 6 hours, configurable
`FORECAST_TTL_HOURS` (default 6). Open-Meteo models update every 1 to 6 hours, so 6 hours loses little freshness and saves quota. Rough budget, measured on the live API (see Open Questions): our forecast request costs about 1.4 units and a marine request about 1, so a refresh is at most ~2.4 units, 4 refreshes/day/location, roughly 10 units/day/location. With a 20% margin that keeps about 800 locations fresh within the 10,000/day allowance.

### D4. Single-flight via a Redis lock per location
`SET key NX PX` lock around the refresh; the winner re-checks the database (double-check), fetches, writes in a transaction, releases. Losers wait briefly then read the database or fall back to stale data. If Redis is down, fall back to an in-process lock with a logged warning.
Alternative: in-process promise map only (breaks with more than one instance).

### D5. Stale-on-error
If the upstream call fails and rows exist, serve them with `stale: true`. No rows: a typed error with a retry hint.

### D6. Marine only when it can return something
First marine fetch for a location records `marineAvailable` (true if any non-null value). When false, later refreshes skip the marine call, halving the cost for inland cities. Surfing is then `available: false`.

### D7. Rate limiting with the Nest throttler backed by Redis
One limit per client key (`x-api-key` header, else IP), shared across instances through Redis. GraphQL needs the guard to read the request from the GraphQL context. Limits and window come from env. On Redis failure, fall back to in-memory counters with a warning.
Alternative considered and cut: a separate, stricter client limit for requests that miss the cache. The upstream pause in D13 covers the same risk more simply.

### D8. Scoring is a separate pure module
`ActivityScorer` takes one day of weather and returns `{ score, rating, reasons[] }` per activity. Start at 100 and subtract capped penalties; thresholds live in one config object.

| Activity | Main inputs | Behaviour |
|---|---|---|
| Outdoor | precipitation, apparent temp, wind/gusts, weather code | penalise rain, wind, outside ~12-27 C; thunderstorm caps the score |
| Indoor | same inputs, inverted with a floor | base 60; bonus for rain/cold/heat; small penalty only for severe weather |
| Skiing | snow depth, snowfall, max temp, wind | no snow gives a very low score; bonus for cold and fresh snow |
| Surfing | wave height, wave period, wind | best at ~1-2.5 m with long period; unavailable without wave data |

Rating bands: 0-39 POOR, 40-59 FAIR, 60-79 GOOD, 80-100 GREAT. Week score is the mean of daily scores; `bestDay` is the max.

### D9. Response shape and metadata
One computed matrix (7 days x activities, each cell `{ score, rating, summary, reasons[] }`) feeds two views, so there is no duplicated logic:
- `byActivity`: ordered by weekly average, with `bestDay` and daily ranks.
- `byDay`: for each date, every available activity's cell and `bestActivity`.
`meta { source: OPEN_METEO | DATABASE, fetchedAt, nextRefreshAt, stale }`. A Redis-level response cache is not built, so there is no third source value.

The `summary` sentence is built from the scorer's reasons: the most important negative or positive reason for that activity plus a short verdict ("Rainy, not great for walking around" / "Good day for museums and indoor plans"). Templates live next to the thresholds in the scoring config so wording and rules change together.

### D13. Upstream pause on 429 (no counters)
One Redis key, `upstream:blocked_until`, written by a tiny `UpstreamGate`:
- When Open-Meteo answers 429, store the resume time: from `Retry-After` or `X-RateLimit-Reset` when present, otherwise now + `UPSTREAM_PAUSE_MINUTES` (default 15). The key expires on its own at that time.
- Before each upstream call the client asks the gate; if paused it throws `OpenMeteoRateLimited` with `retryAfterSeconds` without any network call.
- The pause is in Redis, so every instance honours it. If Redis is down the gate falls back to an in-memory value with a warning.
- The cost is one wasted request when the limit is first hit. Alternative considered: per-minute/hour/day counters (avoids that request and shows remaining allowance) - cut as unnecessary for this scope because the 6-hour refresh interval keeps usage far below the free-tier limits; named in the README as a next step.

### D14. Error model
Four typed GraphQL errors with stable `extensions.code`: `LOCATION_NOT_FOUND`, `CLIENT_RATE_LIMITED`, `OPEN_METEO_RATE_LIMITED`, `OPEN_METEO_UNAVAILABLE`. Each has a user-safe message and, where it makes sense, `extensions.retryAfterSeconds`. The quota message is rendered with a rounded wait ("about 15 minutes"). Resolution order for a refresh: fresh data wins; else try upstream; on quota/failure serve stale if any; else the typed error.

### D15. Code structure and quality bar
Layered and dependency-injected so each unit is testable in isolation: resolvers only translate; services hold logic; the Open-Meteo client, clock and Redis are injected and replaced in tests. The clock is an injected dependency, not `Date.now()` calls scattered around. Jest coverage is enforced in CI-style config (target 90% lines and branches overall, 100% for the scoring module); the test run fails below the threshold. ESLint and Prettier are configured and run in the `tests` container.

### D16. Location resolution (checked against the live geocoding API)
Observed behaviour: results are relevance-ranked (population-weighted); the optional `countryCode` filter (ISO alpha-2) works; Cyrillic and alternate spellings resolve ("Минск" gives Minsk BY, "Munchen" gives Munich); partial input matches by prefix ("Lond" gives London); a single character and gibberish return an empty result with no `results` field rather than an error; results include non-city features (an airport next to Zermatt, tiny hamlets).
Decisions:
- Ask for up to 5 matches, keep only populated places (feature code `PPL*`), take the first one. "Best match" therefore means what the geocoder ranks first among real towns and cities.
- Pass `countryCode` through when the client supplies it. `searchLocations` returns the candidate list so a client can pick one.
- Input shorter than 2 characters is rejected before any upstream call; a missing `results` field maps to `LOCATION_NOT_FOUND`.
- The response always includes the chosen location (name, region, country), so a wrong guess is visible.
- The geocoder's own id is the unique key of a stored `Location`, so alternate spellings of one place share one row and one refresh.
- Names are requested in English; storing coordinates, time zone and id means later requests never depend on spelling.

### D17. Redis holds only disposable data; automatic expiry first, memory limit as a safety net
Everything in Redis is short-lived: client limit counters (TTL = window), per-location refresh locks (TTL ~30 s) and the `upstream:blocked_until` pause (TTL until it ends). Cities and weather are **not** stored in Redis.
- **Primary mechanism: TTL on every key.** A small Redis wrapper only offers "set with TTL", so a key without expiry cannot be written by accident.
- **Safety net: `maxmemory` with `volatile-lru`** (compose default 64 MB), persistence off (`--save "" --appendonly no`) because nothing needs to survive a restart. When memory is full, Redis evicts the least-recently-used keys that have a TTL.
- **Do not use `noeviction`.** Verified on the real image (`docs/research/redis-eviction-check.sh`): with a 3 MB limit, 40,000 writes under `volatile-lru` all succeeded (31,792 old keys evicted, 0 errors, a key without TTL survived, TTL expiry worked), while under `noeviction` 31,395 of 40,000 writes failed with OOM errors. Failing writes would break the rate limiter.
- If an evicted key was a limit counter, that client simply gets a fresh window; if it was a lock, the next request re-checks the database. Both degrade safely.

### D18. Bounded city storage in Postgres, cleaned lazily
Postgres has no TTL, and stored cities would otherwise grow without bound. `Location` gets `lastRequestedAt` (updated at most once per hour per location to avoid a write on every read). Config `MAX_STORED_LOCATIONS` (default 1000, close to the ~800 locations the quota allows to stay fresh). When a new location is inserted and the count exceeds the cap, the least recently requested location is deleted in the same transaction; its weather rows and fetch state go with it (cascade). No scheduler or background job is needed. Past days are already removed on every refresh. An evicted city is simply geocoded and fetched again if someone asks for it later.
Alternative considered: delete cities not requested for N days with a scheduled job (more moving parts, and the cap already bounds size).

### D10. Apollo Sandbox must be enabled explicitly
Apollo Server hides the embedded Sandbox when `NODE_ENV=production`, which is what the container image uses. The landing page plugin is configured to always embed Sandbox. The page loads its UI from Apollo's CDN, so it needs internet access; the service itself does not.

### D11. Docker and tests
Multi-stage `Dockerfile`; `docker-compose.yml` with `app`, `postgres`, `redis` (health-checked) and a `tests` service under a profile. App container applies Prisma migrations on start. Tests: unit (scorer, freshness logic), service-level (refresh with a fake provider), e2e (GraphQL over HTTP against real Postgres/Redis with Open-Meteo mocked using recorded real responses for Innsbruck, Munich and Biarritz). Postman collection lives in `postman/`.

### D12. Module layout
`OpenMeteo` (HTTP client, mapping), `UpstreamGate` (pause after 429), `Locations`, `Forecast` (TTL, lock, stale), `Scoring`, `Ranking` (resolver and composition of both views), `Throttling`, `Errors` (typed GraphQL errors), `Health`, `Config`, `Redis`, `Prisma`, `Clock`.

## Risks / Trade-offs

- [Snow at the city does not equal snow at ski resorts] -> documented limitation; skiing reflects the geocoded point only.
- [Ambiguous names resolve to the most populous match] -> response shows the chosen location; country code parameter available.
- [Free tier is non-commercial and has no uptime guarantee] -> stale fallback; README notes it.
- [Redis outage weakens limits and locks] -> degrade to in-process behaviour with warnings instead of failing requests.
- [Heuristic scores are subjective] -> reasons are returned with every score and all thresholds are in one config.
- [Sandbox needs CDN access] -> README notes it; Postman collection is the offline alternative.
- [The first rejection costs one wasted upstream request] -> accepted; the pause then protects all later requests and all instances.
- [A burst of many distinct new cities can still exhaust the allowance] -> those users get the clear `OPEN_METEO_RATE_LIMITED` error with a retry time while known cities keep working from stored data.

## Open Questions

- Exact numeric defaults for the client limit (starting point: 60 requests/minute) can be tuned during implementation without changing the specs.
- Can batching several cities into one Open-Meteo request save quota? Checked against the live API (response header `X-RateLimit-Cost`): **no for quota, only for round trips.** One location costs 1.0 and 3 locations cost 3.0 and 10 locations cost 10.0, so the cost is per location, not per request. Cost also grows with request size: 4 daily variables plus hourly snow depth for 7 days is 1.0, while 12 daily variables plus 2 hourly ones is 1.4; 16 days instead of 7 did not change it for a single variable. The marine API did not return a cost header, so its weight is unmeasured. Consequences: the real savings are fewer variables per request (request only fields the scorers use), the 6-hour refresh interval, and skipping marine for inland cities. Batching would still cut HTTP overhead for a future background refresh job, so it is kept as a follow-up and described in the README, not built now.

## Future Improvements

Not part of version one; each is described in the README so the reasoning is visible.

- **Batch several cities per Open-Meteo request.** Version one makes one call per location, triggered by one user request. Measured cost is per location, so batching saves round trips, not quota; it becomes useful with a background refresh job.
- **Usage counters** (minute, hour, day) to avoid the one wasted request when the allowance is first exceeded and to show remaining allowance.
- **Background refresh** of popular locations so users rarely wait for an upstream call.
- **Nearby ski resorts** instead of the city point, since snow in a city does not reflect the slopes; optionally request the forecast at slope elevation.
- **Stricter limit for requests that need an upstream call** than for cached ones.
- **History of forecasts** (where a time-series store such as TimescaleDB would make sense) to compare predictions with reality.
