# syntax=docker/dockerfile:1
# =================================================================================================
# How this file is used
#
#   docker compose up --build            builds the "runtime" image and starts the service
#   docker compose run --rm tests        builds the "test" image and runs lint + all tests
#
# One Dockerfile, two results. It is split into STAGES ("FROM ... AS name"). A stage starts from
# an earlier one and adds a step; the two images at the end ("test" and "runtime") pick only what
# they need, so the production image has no compiler, no tests and no dev tools.
#
#   base ──► deps ──┬──► build ──► (compiled code is copied into) runtime   = what runs in prod
#                   └──► test                                              = what runs the checks
#
# Why stages at all: smaller, safer production image, and Docker caches each step, so a rebuild
# after a code change only redoes the steps that actually changed.
# =================================================================================================


# -------------------------------------------------------------------------------------------------
# Stage 1: base - the operating system and settings every other stage shares
# -------------------------------------------------------------------------------------------------
# Node 24 is the current long-term-support release. "bookworm-slim" = Debian 12 without extras.
# Debian (not Alpine) on purpose: Prisma's database engine is built for the standard Linux C
# library and needs extra setup on Alpine.
FROM node:24-bookworm-slim AS base

# Install two OS packages. Everything is ONE command so the downloaded package lists can be
# deleted in the same step (a delete in a later step would not shrink the image).
#   apt-get update              refresh the list of installable packages
#   --no-install-recommends     do not install optional extras
#   openssl                     Prisma's engine loads this library on start-up and crashes without it
#   ca-certificates             lets HTTPS calls (to Open-Meteo) verify the server's certificate
#   rm -rf /var/lib/apt/lists   delete the package lists, we do not need them at runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# All following commands run inside /app, and our files live there.
WORKDIR /app

# Silence the Prisma CLI: no "new version available" banner, no usage-statistics call.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1


# -------------------------------------------------------------------------------------------------
# Stage 2: deps - install every npm package (used to build the code and to run the tests)
# -------------------------------------------------------------------------------------------------
FROM base AS deps

# Copy ONLY the package list first, not the source code. Docker caches a step until its inputs
# change, so while these two files stay the same the slow "npm ci" below is skipped, even when
# you edited source files. This is the most useful trick in this file.
COPY package.json package-lock.json ./

# Installing @prisma/client generates the database client from the schema, so it needs to be here.
COPY prisma ./prisma

# "npm ci" ("clean install") installs exactly the versions written in package-lock.json and fails
# if the lock file and package.json disagree. Unlike "npm install" it never changes the lock file,
# which makes builds repeatable. (The "ci" has nothing to do with this project's tests: it is npm's
# own command meant for automated builds.)
RUN npm ci


# -------------------------------------------------------------------------------------------------
# Stage 3: build - turn TypeScript into JavaScript that Node can run
# -------------------------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# 1) prisma generate: create the typed database client (the code imports it)
# 2) tsc: compile src/ into dist/. tsconfig.build.json leaves the test files out.
RUN npx prisma generate && npx tsc -p tsconfig.build.json


# -------------------------------------------------------------------------------------------------
# Stage 4: test - the image behind `docker compose run --rm tests`
# -------------------------------------------------------------------------------------------------
FROM deps AS test

# The tests need everything: source, tests, fixtures, configs (.dockerignore keeps junk out).
COPY . .
RUN npx prisma generate

# "npm run check" (see package.json) runs, in order: code style checks, applies the database
# migrations to the test schema, then runs ALL tests and fails if coverage is too low.
# Postgres and Redis are started by docker compose; see the "tests" service in docker-compose.yml.
CMD ["npm", "run", "check"]


# -------------------------------------------------------------------------------------------------
# Stage 5: runtime - the small image that actually runs the service
# -------------------------------------------------------------------------------------------------
FROM base AS runtime

# Tells Node libraries (Nest, Express, ...) to use their faster, quieter production mode.
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma

# Install ONLY what the running service needs (no jest, eslint, typescript...):
#   npm ci --omit=dev     production packages only. "prisma" is deliberately one of them,
#                         because this container applies database migrations when it starts.
#   npx prisma generate   create the database client
#   npm cache clean       delete npm's download cache so it does not stay in the image
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

# Take just the compiled code from the build stage; none of the TypeScript sources.
COPY --from=build /app/dist ./dist

# Do not run as root: if the service were ever compromised, root inside the container is more
# dangerous. The base image already has an unprivileged user called "node"; give it /app (the
# service writes schema.gql there) and switch to it.
RUN chown node:node /app
USER node

# Documentation only: the service listens on 3000. Publishing the port is done in docker-compose.yml.
EXPOSE 3000

# What happens when the container starts:
#   1. prisma migrate deploy   create or update the database tables if they are not up to date
#   2. node dist/main.js       start the service
# Doing the migration here is why `docker compose up` needs no manual database step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
