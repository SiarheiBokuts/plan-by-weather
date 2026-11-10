# Decisions

Short records of what I chose, what I rejected, and why. The long form, including data from the live
API that shaped these, is in
[`openspec/changes/build-weather-activity-ranking/design.md`](../openspec/changes/build-weather-activity-ranking/design.md).
Newest findings last. Dates are 2026-11-10.

## Storage and refresh

- **Postgres is the source of truth; weather is stored normalized, scores are computed on read.**
  *Rejected:* storing raw JSON (ties storage to the upstream shape), storing scores (rules change, old
  numbers would linger), a time-series database (7 rows per city, overwritten on refresh, no history to keep).
- **Refresh at most every 6 hours per city, lazily on request.** Open-Meteo models update every 1-6 h.
  *Rejected:* a background job refreshing everything (more moving parts, spends quota on cities nobody asks about).
- **One Redis lock per city so concurrent requests cause one Open-Meteo call.** Followers wait and read
  the result. Tested with ten simultaneous requests. *Rejected:* an in-process promise map (breaks with two instances).
- **Locations are keyed by the geocoder's id, with an alias table for what users typed.** Alternate
  spellings share one row; repeated names never call the geocoder. Uniqueness is enforced by the
  database and tested, including a race.
- **Bounded storage by count**, deleting the least recently requested city, lazily when a new one is inserted. No scheduler.

## Quota and limits

- **React to the upstream's `429` with one shared pause key, instead of counting usage.**
  Measured: the free allowance is 10,000 units/day and a city costs about 10 units/day at a 6-hour
  refresh, so normal use is far below it. Counters would avoid one wasted request, at the price of code
  that estimates a limit we do not control. *Kept as future work.*
- **Batching cities into one Open-Meteo request does not save quota** (measured: cost is per location),
  so version one makes one call per location. *Future work for a background job, to save round trips only.*
- **Per-client limit by `x-api-key`/IP, counted in Redis**, custom guard (about 20 lines) instead of the
  Nest throttler package, because that package needs extra work to read a GraphQL request and a guard I
  can fully unit-test is simpler to reason about.
- **Redis is disposable.** Every key has a TTL (the wrapper cannot write one without it);
  `maxmemory` + `volatile-lru` is the safety net; persistence off. Verified on the real image: under
  `volatile-lru` 40,000 writes into a 3 MB limit all succeeded, under `noeviction` 31,395 failed. If Redis is down the service falls back to in-memory state and logs a warning.

## Scoring

- **Simple, explainable rules, all numbers in one file** (`scoring-config.ts`), one pure scorer per
  activity, each returning reasons. Indoor sightseeing is a baseline that rises as outdoor weather worsens,
  not a mirror image. Heavy rain alone must read as POOR for outdoors; that is why rain has a base penalty.
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
- **Apollo Sandbox is enabled explicitly**, because Apollo hides it when `NODE_ENV=production`, which the container uses.
- **Docker:** a multi-stage build; the test image and the production image share the dependency stage.
  Migrations run when the app container starts, so `docker compose up` needs no manual database step.

## Testing

- Unit tests for every rule; **integration tests on real Postgres and Redis** (not mocks) for storage,
  refresh, concurrency, eviction and uniqueness; **end-to-end tests over HTTP** for the API and its errors.
  Open-Meteo is replaced with responses recorded from the real API.
- Coverage is enforced (90% overall, 100% lines for scoring). Reached: 100% lines, 97% branches.
- A bug found by the tests, not by reading: the enum names above. A bug found by reading: with an empty week all activities collapsed into one; fixed and covered.
