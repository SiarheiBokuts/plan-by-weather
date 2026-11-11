# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A take-home exercise: a backend service that ranks how good the next 7 days are for skiing, surfing, outdoor sightseeing and indoor sightseeing in a given city, using persisted Open-Meteo data. Stack: NestJS, TypeScript, GraphQL, Prisma, Postgres, Redis, Docker. No front end required; the only one is a small optional test page in `public/` (off by default).

Keep it simple. Prefer the simplest design that reasons well, and document known pitfalls in the README rather than building for them.

## Spec-driven workflow (OpenSpec)

Planning lives in `openspec/`:

- `openspec/changes/build-weather-activity-ranking/` holds the current change: `proposal.md`, `design.md`, `specs/*/spec.md`, `tasks.md`.
- Read `design.md` and the specs before writing code; implement `tasks.md` in order and tick the boxes as you go.
- Use the project commands `/opsx:propose`, `/opsx:apply` and `/opsx:archive` (defined in `.claude/`).
- If behavior changes, update the spec first, then the code.

## Exploring the running service

- Primary: **Apollo Sandbox** at `http://localhost:4747/graphql` (schema docs and query runner in the browser; it is explicitly enabled in the container image).
- Secondary: the Postman collection in `postman/`.
- Every ranking response includes `meta.source` (`OPEN_METEO` or `DATABASE`) so you can see where the data came from.

## Folder and code structure standards

Follow these when adding or changing code. They are the NestJS conventions, applied consistently.

### Where things go

```
src/
  config/           env variables -> one typed, validated AppConfig (injected via APP_CONFIG)
  common/           cross-cutting, no business logic: clock, typed errors, guards
  domain/           plain types and helpers shared by modules; no framework, no I/O
  infrastructure/   adapters to ONE outside thing each: prisma (database), redis, open-meteo (HTTP)
  modules/<feature>/   a feature: <feature>.module.ts, .service.ts, .resolver.ts (GraphQL)
                       or .controller.ts (REST), types/DTOs, and unit specs next to the code
test/               integration + e2e tests, support/ (fakes, builders), fixtures/ (recorded API responses)
```

- **Layers, one job each:** handler (resolver/controller/guard) receives and answers; service holds the
  rules; repository stores and reads data (the ONLY code that uses Prisma); client fetches data from
  outside (the ONLY code that makes HTTP calls to Open-Meteo); scoring is pure rules. A handler never
  touches a repository or client directly; a service never writes SQL or builds a URL.
- **Dependencies point inward.** `modules` may import `infrastructure`, `domain`, `common`, `config`.
  `infrastructure` and `common` never import `modules`. `domain` imports nothing from the app.
- **A resolver or controller only translates** the request and response. Logic lives in services;
  rules that need no I/O (like scoring) are pure functions that can be tested without Nest.
- **One thing per file, named `<name>.<role>.ts`** (kebab-case): `module`, `service`, `resolver`,
  `controller`, `guard`, `repository`, `scorer`, `types`, `mapper`, `client`, `spec`. No catch-all `utils` files.
- **Inside a module, keep files flat until it grows.** A module of up to about 8 files stays in one
  folder (readable at a glance; a folder with one or two files only adds clicks). When it grows past
  that, group by role in subfolders: `services/`, `repositories/`, `resolvers/`, `dto/`. `scoring/`
  already has `scorers/` because it holds four parallel files of the same kind.
- **A new feature gets its own folder under `modules/`** with its own Nest module. A new outside
  system gets its own folder under `infrastructure/`.

### Code rules

- **Time:** use the injected `Clock`, never `Date.now()` or `new Date()` in services.
- **Config:** read settings only through `APP_CONFIG`; never `process.env` outside `config/`. Scoring
  thresholds live only in `scoring-config.ts`; after changing them run `npm run docs:scoring` to
  regenerate `src/modules/scoring/config/SCORING.md` (a test checks it) and keep `scoring.calibration.spec.ts` passing.
- **Redis:** keys are disposable and always written with a TTL (the wrapper enforces it).
- **Errors:** throw the typed errors from `common/errors.ts` (stable `extensions.code`, message safe to
  show to a user). Do not hide unexpected errors as upstream problems.
- **Database:** change the schema in `prisma/schema.prisma` and create a migration
  (`npm run prisma:migrate:dev`); document unique keys next to the model.
- **Comments say why**, not what. Anything non-obvious (a workaround, a measured number, a trade-off)
  gets a short reason.
- **TypeScript:** strict mode; no `any` outside tests that handle dynamic JSON.

### Tests

- Every rule and every error path has a test. Test a service on its own with a fake repository and client
  (see `locations.service.spec.ts`); the repository and the whole flow are covered on real Postgres and
  Redis in `test/integration`. Unit specs sit next to the code (`*.spec.ts`);
  anything that needs Postgres or Redis goes in `test/integration`, API behaviour in `test/e2e`.
- Open-Meteo is never called in tests; use the responses recorded from the real API in `test/fixtures`.
- `docker compose run --build --rm tests` must stay green; coverage thresholds are enforced (90% overall,
  100% lines for scoring).
- When a bug is found, add the test that would have caught it, then fix it.

## Commands

```bash
docker compose up --build          # start app + postgres + redis
docker compose run --build --rm tests      # run the whole test suite
npm run up                                  # start in the background and print the addresses (also for Wi-Fi)
npm run lan                                 # print the addresses again
npm run start:dev                           # app from source with .env.dev (docker compose up -d postgres redis first)
npm run docs:scoring                        # after changing scoring-config.ts
```

## Conventions

- API research (limits, cost per request, geocoding behaviour) lives in `docs/research/`; the recorded responses are the test fixtures in `test/fixtures/`.
- Keep decisions and assumptions in `docs/DECISIONS.md` and `docs/QUESTIONS.md`; record what was cut and why.
- Hand-written code that a library could do, or anything not obvious, gets a short comment at the code itself:
  why it is written this way and what could replace it. No separate document for that.
