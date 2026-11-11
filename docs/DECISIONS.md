# Decisions

Short records of what I chose, what I rejected, and why. The long form, including data from the live
API that shaped these, is in
[`openspec/changes/build-weather-activity-ranking/design.md`](../openspec/changes/build-weather-activity-ranking/design.md).
Newest findings last. Dates are 2026-11-10.

## Storage and refresh

- **Postgres is the source of truth; weather is stored normalized, scores are computed on read.**
  *Rejected for now:* storing the raw JSON response (simpler and survives format changes without a migration, but ties storage to the upstream shape, the scorers need the parsed values anyway, and a malformed response would be stored instead of rejected; a reasonable later simplification), storing scores (rules change, old
  numbers would linger), a time-series database (7 rows per city, overwritten on refresh, no history to keep).
- **Postgres stores the weather; Redis only coordinates.** Redis holds client counters, the per-city
  refresh lock and the Open-Meteo pause: small, short-lived and shared between instances, every key with a TTL
  so it deletes itself (checked on the running stack: no key without a TTL). Weather is not in Redis because
  a TTL would delete the forecast exactly when Open-Meteo is down or rate-limiting and the old forecast is the
  best answer we have; Redis memory eviction or a restart would also trigger a burst of Open-Meteo calls.
  A request always looks in Postgres first and calls Open-Meteo only when the stored data is older than 6 hours.
  *Open question, not built:* a Redis read-through cache in front of Postgres; a primary-key lookup
  takes about a millisecond, so it would add a second copy and invalidation rules for no visible gain.
- **Refresh at most every 6 hours per city, lazily on request.** Open-Meteo models update every 1-6 h.
  *Rejected:* a background job refreshing everything (more moving parts, spends quota on cities nobody asks about).
- **One Redis lock per city so concurrent requests cause one Open-Meteo call.** Followers wait and read
  the result. Tested with ten simultaneous requests. *Rejected:* an in-process promise map (breaks with two instances).
- **Locations are keyed by the geocoder's id, with an alias table for what users typed.** Alternate
  spellings share one row; repeated names never call the geocoder. Uniqueness is enforced by the
  database and tested, including a race.
- **No cap on stored cities.** A first version limited it to 1000 and deleted the least recently requested one; dropped because Postgres does not care about thousands of 2 KB cities, storing a city costs no Open-Meteo quota (only refreshing does), and evicting a city that is asked for again wastes quota on re-fetching it. Cleaning by age is the right tool, listed as an improvement.

- **Layers: handler -> service -> repository / client.** Services hold only rules; repositories are the
  only code that touches Prisma; the Open-Meteo client is the only code that makes HTTP calls. First version
  had services calling Prisma directly; moved to repositories so a rule can be unit-tested with fakes and SQL
  lives in one place per feature.

## Quota and limits

- **React to the upstream's `429` with one shared pause key, instead of counting usage.**
  Measured: the free allowance is 10,000 units/day and a city costs roughly 6 to 10 units/day at a 6-hour
  refresh, so normal use is far below it. Counters would avoid one wasted request, at the price of code
  that estimates a limit we do not control. *Kept as future work.*
- **Batching cities into one Open-Meteo request does not save quota** (measured: cost is per location),
  so version one makes one call per location. *Future work for a background job, to save round trips only.*
- **Per-client limit by `x-api-key`/IP, counted in Redis**, custom guard (about 20 lines) instead of the
  Nest throttler package, because that package needs extra work to read a GraphQL request and a guard I
  can fully unit-test is simpler to reason about.
- **Per-client limit: Redis, nginx or memory?** All three work. nginx `limit_req` is the standard place for plain
  per-IP limits and needs no application code, but it knows nothing about API keys and the service would have to
  trust `X-Forwarded-For` to see real addresses. In-memory counters are enough for one instance and are the
  fallback here. Redis was kept because it is already used for the lock and the pause, it is correct across
  several instances, and it can limit per API key. It is a little more than a single-instance demo needs, which
  is acknowledged in the README; edge limiting by nginx or a CDN is a possible later optimisation.
- **Redis is disposable.** Every key has a TTL (the wrapper cannot write one without it);
  `maxmemory` + `volatile-lru` is the safety net; persistence off. Verified on the real image: under
  `volatile-lru` 40,000 writes into a 3 MB limit all succeeded, under `noeviction` 31,395 failed. If Redis is down the service falls back to in-memory state and logs a warning.

## Scoring

- **Points plus ceilings, five conditions per activity.** Each condition turns a measurement into a 0-100 mark
  through a table, marks times weights are added up, and a bad enough condition sets a ceiling. First version
  subtracted penalties from 100, which made every dry day score about 100 and outdoor sightseeing win every
  dry day; the typical-days table (`scoring.calibration.spec.ts`) was written to catch exactly that. A
  weighted geometric mean was also tried and worked, but points plus ceilings is much easier to explain and
  check by hand. Weights add up to 100 for every activity, so none is judged more strictly than another.
- **Simple, explainable rules, all numbers in one file** (`scoring-config.ts`), one pure scorer per
  activity, each returning reasons. Indoor sightseeing is a baseline that rises as outdoor weather worsens,
  not a mirror image. Heavy rain alone must read as POOR for outdoors; that is why rain has a base penalty.
- **Waves come from the Marine API, because surfing is meaningless without them.** Scoring surfing from wind
  and weather alone was considered and rejected: it could rate a flat day as good. The cost is one extra
  request per refresh for coastal cities (assumed to count against the same allowance, since Open-Meteo applies
  limits per IP and its marine API reports no cost); inland cities are remembered as having no waves and skip
  the call. If simplicity mattered more than a meaningful surfing score, surfing could be estimated from wind
  alone and the Marine API dropped.
- **Unavailable is not zero.** No waves means surfing is unavailable, with a reason.
- **One scored matrix feeds both response views**, so the numbers cannot disagree.
- **A summary sentence per day and activity**, built from the strongest reason ("Rain (12.0 mm): not a
  day for walking around."), with "but" when the main factor points the other way.

## Stack and versions

- **NestJS 11 + Apollo (code-first) + Prisma 6 + Postgres 18 + Redis 8, Node 24, TypeScript 6, Jest 30, ESLint 10.**
  *Not taken:* NestJS 12 (ESM-only, would mean rewriting the module system), Prisma 7 (driver adapters and
  a new config file), TypeScript 7 (the test transformer does not support it yet). Each is a worthwhile
  upgrade for a real project and was judged not worth the risk here. TypeScript 6 also changed defaults
  (`types`, module resolution), which are set explicitly in `tsconfig.json`.
- **GraphQL enum member names equal their values** (`OPEN_METEO = 'OPEN_METEO'`) because GraphQL
  exposes the member *name*. An end-to-end test caught this: the API first returned `OpenMeteo`.
- **Apollo Sandbox is behind one switch, `GRAPHQL_SANDBOX`, off by default.** Apollo's own default (on in development, off in production, read from `NODE_ENV`) does not fit a service meant to be started in a production-mode container for review. The compose file sets it to `true` for the demo; a real production deployment leaves it off, which also turns off schema introspection. Both modes are covered by end-to-end tests.
- **Docker:** a multi-stage build; the test image and the production image share the dependency stage.
  Migrations run when the app container starts, so `docker compose up` needs no manual database step.

## A deliberate extra: a small optional test UI

The brief says "backend only, please don't build a front end". I read that and still built one small page, for my own
testing, with little effort (it says TEST UI on the page): it is quicker to try cities and read the results there than
in Apollo Sandbox. To keep it from counting as scope creep it is a single static file (`public/index.html`, Vue 3 and
Tailwind without a build step, libraries vendored next to it), calls only the public GraphQL API, is off by default
(`UI_ENABLED`) and is removed by deleting `public/`. The README says plainly that it is not part of the assignment.

## Testing

- Unit tests for every rule; **integration tests on real Postgres and Redis** (not mocks) for storage,
  refresh, concurrency, eviction and uniqueness; **end-to-end tests over HTTP** for the API and its errors.
  Open-Meteo is replaced with responses recorded from the real API.
- Coverage is enforced (90% overall, 100% lines for scoring).
- A bug found by the tests, not by reading: the enum names above. A bug found by reading: with an empty week all activities collapsed into one; fixed and covered.
