# syntax=docker/dockerfile:1
# Two images from one file: "runtime" (the service) and "test" (lint + all tests, see docker-compose.yml).

FROM node:24-bookworm-slim AS base
# openssl: Prisma's engine needs it. ca-certificates: HTTPS calls to Open-Meteo.
# Debian instead of Alpine because Prisma's engine needs the standard C library.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# No update banners in the logs (Prisma, npm) and no usage-statistics call.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1 NPM_CONFIG_UPDATE_NOTIFIER=false

FROM base AS deps
# Package files first: the slow install stays cached until they change, even if the source does.
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Installs exactly the versions in package-lock.json (npm's repeatable install, unrelated to tests).
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json

FROM deps AS test
COPY . .
RUN npx prisma generate
# lint, format check, migrations, all tests with a coverage check
CMD ["npm", "run", "check"]

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Production packages only (plus "prisma", needed to run migrations on start).
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
# Not root; /app must be writable because the service writes schema.gql there.
RUN chown node:node /app
USER node
EXPOSE 3000
# What runs when the container starts: 1) the database migrations, 2) the service itself.
# (`exec` in the line below makes the service the container's main process, so `docker stop` stops it right away.)
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
