# Database migrations

The schema is `schema.prisma`. The database is changed only by the SQL files in `migrations/`,
which Prisma applies in order and records in a `_prisma_migrations` table.

## Two different jobs: "create a migration" and "apply migrations"

A **migration** is a SQL file in `migrations/`. Two separate things can happen to it:

1. **Creating** it: writing a new SQL file that describes a schema change. You do this on your
   machine, once per change, and commit the file to git.
2. **Applying** it: running the SQL against a database so its tables change. This happens on
   every database that needs it (your laptop, the test run, a production server), and Prisma
   remembers which files it already ran, so each file runs only once per database.

| Command | Creates a migration file? | Changes the database? | When to run it |
|---|---|---|---|
| `npm run prisma:migrate` (`prisma migrate deploy`) | No | **Yes**: applies every migration file that has not run on this database yet. If everything already ran, it does nothing. | Automatic when the Docker container starts and in the test run. Run it yourself on a database after pulling new migration files. |
| `npm run prisma:migrate:dev` (`prisma migrate dev`) | **Yes**: compares `schema.prisma` with the existing migrations and writes a new file for the difference | **Yes**: also applies it to your development database right away | Only after you changed `schema.prisma`. Give it a name: `npm run prisma:migrate:dev -- --name add_something`. Needs a running database. |
| `npm run prisma:generate` (`prisma generate`) | No | No: only regenerates the typed TypeScript client from `schema.prisma` | After every schema change. The build and Docker do it automatically. |

So to **apply** migrations to a database you simply run `npm run prisma:migrate`; the word
"deploy" in the Prisma command means "apply the existing files", it does not create anything new.

Normal workflow after editing the schema:

```bash
docker compose up -d postgres redis
export DATABASE_URL='postgresql://weather:weather@localhost:54329/weather?schema=public'
npm run prisma:migrate:dev -- --name describe_the_change   # writes prisma/migrations/<time>_describe_the_change/
git add prisma                                              # commit schema and migration together
```

## How the first migration (`20261110000000_init`) was created

There was no database yet, so the SQL was generated straight from the schema, without connecting
to anything:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/20261110000000_init/migration.sql
```

`migrations/migration_lock.toml` (`provider = "postgresql"`) was added next to it, as Prisma
expects. It was then applied with `prisma migrate deploy` to a real Postgres, and checked by
generating the SQL again from the schema and confirming it is byte-for-byte identical.

From now on use `prisma:migrate:dev` for changes; `migrate diff --from-empty` is only for the very
first migration.

## Uniqueness

The unique keys of every table, and how each is enforced and tested, are documented at the top of
`schema.prisma` and above each model.
