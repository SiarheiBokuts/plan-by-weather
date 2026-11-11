#!/bin/sh
# Runs every check in order and says plainly what passed and what failed.
# This is what `npm run check` (and so `npm run test:docker` and the GitHub workflow) runs.
# It stops at the first failing step, because the next ones would only repeat the same problem.

if [ -t 1 ]; then green='\033[32m'; red='\033[31m'; bold='\033[1m'; off='\033[0m'; else green=''; red=''; bold=''; off=''; fi
passed=""

step() {
  name="$1"; shift
  printf '\n%b==> %s%b\n' "$bold" "$name" "$off"
  if "$@"; then
    printf '%b✔ %s: passed%b\n' "$green" "$name" "$off"
    passed="$passed\n  ✔ $name"
  else
    printf '\n%b✖ %s: FAILED%b (the output above says why)\n' "$red" "$name" "$off"
    [ -n "$passed" ] && printf 'Passed before that:%b\n' "$passed"
    exit 1
  fi
}

step "1/4 Lint (code rules)"                    npm run --silent lint
step "2/4 Format (code style)"                  npm run --silent format:check
step "3/4 Database migrations"                  npx prisma migrate deploy
step "4/4 Tests (unit, integration, end-to-end), with coverage" npx jest --coverage --verbose

printf '\n%b========================================%b\n' "$green" "$off"
printf '%bALL CHECKS PASSED%b%b\n' "$green" "$off" "$passed"
