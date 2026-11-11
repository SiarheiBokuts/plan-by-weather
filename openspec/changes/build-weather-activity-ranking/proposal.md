# Proposal

## Why

The take-home exercise asks for a backend service that takes a city and ranks how good the next 7 days are for skiing, surfing, outdoor sightseeing and indoor sightseeing, using Open-Meteo data that is persisted rather than fetched on every request. The shape of the task is deliberately loose, so this change pins down the scope, the assumptions and the simplest design that still reasons well about storage, refresh and quota.

## What Changes

- New GraphQL service (NestJS, TypeScript) with an `activityRanking(city)` query that returns, per activity, a 0-100 score, a rating, the best day and per-day scores with human-readable reasons.
- Weather is resolved from Open-Meteo (geocoding, forecast, marine), persisted in Postgres, and refreshed at most once per configurable interval (default 6 hours) per location.
- Every response says where its data came from (`OPEN_METEO` or `DATABASE`), when it was fetched, and whether it is outdated.
- Redis backs a per-client request limit and a per-location refresh lock so concurrent requests cause at most one upstream call.
- A deliberately simple, separate scoring service decides how suitable a day is for each activity, and every day/activity pair gets a one-sentence plain-language description ("Rainy, not great for walking; a good day for museums").
- The ranking is available both per activity (with best day) and per day (with the best activity of the day).
- When Open-Meteo answers "too many requests", the service remembers until when (one shared key), stops calling it, serves stored data as outdated, and returns a clear error with an approximate retry time for new cities. No usage counters: the free tier has modest limits and no uptime guarantee, and the README states that the service copes with that and names counters as a possible next step.
- Enforced test coverage threshold, with the scoring module fully covered.
- One-command start (`docker compose up --build`) and one-command tests (`docker compose run --build --rm tests`); Apollo Sandbox at `/graphql` (switched on by `GRAPHQL_SANDBOX`, as the compose file does) is the primary way to explore the service, with a small importable Postman collection as a bonus.
- Known limitations (snow at the city vs. at the slopes, ambiguous city names, usage counters for the upstream allowance, per-country limits) are documented, not built.

## Capabilities

### New Capabilities
- `activity-ranking`: the GraphQL query, per-activity and per-day scoring, ordering, and response metadata.
- `weather-data-refresh`: resolving a city to a location, persisting forecast data, refresh interval, concurrency protection and outdated fallback.
- `client-rate-limiting`: per-client request limiting without authentication.
- `upstream-quota-protection`: pause after an upstream rate-limit answer, outdated fallback and user-friendly errors when the Open-Meteo allowance runs out.
- `local-run-and-verification`: starting the stack, running the tests, and exploring the API.

### Modified Capabilities
<!-- None: greenfield project. -->

## Impact

- New code: the whole service (`src/`), Prisma schema and migrations, `Dockerfile`, `docker-compose.yml`, tests and fixtures, `postman/` collection.
- External dependency: Open-Meteo free tier (600 calls/min, 5,000/hour, 10,000/day, non-commercial use only).
- Infrastructure: Postgres (source of truth) and Redis (limits and locks).
- Process artifacts for reviewers: `README.md`, `docs/DECISIONS.md`, `docs/QUESTIONS.md`, AI session log.
