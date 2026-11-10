# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A take-home exercise: a backend service that ranks how good the next 7 days are for skiing, surfing, outdoor sightseeing and indoor sightseeing in a given city, using persisted Open-Meteo data. Stack: NestJS, TypeScript, GraphQL, Prisma, Postgres, Redis, Docker. No frontend.

Keep it simple. Prefer the simplest design that reasons well, and document known pitfalls in the README rather than building for them.

## Spec-driven workflow (OpenSpec)

Planning lives in `openspec/`:

- `openspec/changes/build-weather-activity-ranking/` holds the current change: `proposal.md`, `design.md`, `specs/*/spec.md`, `tasks.md`.
- Read `design.md` and the specs before writing code; implement `tasks.md` in order and tick the boxes as you go.
- Use the project commands `/opsx:propose`, `/opsx:apply` and `/opsx:archive` (defined in `.claude/`).
- If behavior changes, update the spec first, then the code.

## Exploring the running service

- Primary: **Apollo Sandbox** at `http://localhost:3000/graphql` (schema docs and query runner in the browser; it is explicitly enabled in the container image).
- Secondary: the Postman collection in `postman/`.
- Every ranking response includes `meta.source` (`OPEN_METEO` or `DATABASE`) so you can see where the data came from.

## Commands

```bash
docker compose up --build          # start app + postgres + redis
docker compose run --rm tests      # run the whole test suite
```

## Conventions

- Scoring rules are pure functions with all thresholds in one config; no I/O inside them.
- Do not call Open-Meteo from tests; use the recorded fixtures.
- API research (limits, cost per request, geocoding behaviour, raw samples, probe script) lives in `docs/research/`; recorded samples there seed the test fixtures.
- Keep decisions and assumptions in `docs/DECISIONS.md` and `docs/QUESTIONS.md`; record what was cut and why.
