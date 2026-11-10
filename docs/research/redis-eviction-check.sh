#!/usr/bin/env bash
# Verifies how Redis behaves when its memory limit is exceeded, for the policy chosen in design D17.
# Needs Docker and the redis image already pulled (it does not pull anything itself).
# Leaves two stopped containers behind; remove them with:
#   docker rm redis-evict-test redis-evict-test-noeviction
set -u
IMG="${REDIS_IMAGE:-redis:8.10.2-alpine}"
VAL=$(printf 'x%.0s' $(seq 1 120))

run_case() {  # $1 container name, $2 policy
  docker run -d --name "$1" "$IMG" redis-server --maxmemory 3mb --maxmemory-policy "$2" --save "" --appendonly no >/dev/null
  sleep 1.5
  docker exec "$1" redis-cli set no_ttl_key keep >/dev/null
  docker exec "$1" sh -c "i=0; while [ \$i -lt 40000 ]; do echo \"SET client:\$i $VAL EX 300\"; i=\$((i+1)); done | redis-cli > /tmp/out.txt"
  echo "policy=$2 -> OK writes: $(docker exec "$1" grep -c OK /tmp/out.txt), OOM errors: $(docker exec "$1" grep -ci oom /tmp/out.txt)"
  echo "  evicted_keys: $(docker exec "$1" redis-cli info stats | grep evicted_keys | tr -d '\r')"
  echo "  key without TTL survived: $(docker exec "$1" redis-cli get no_ttl_key)"
  docker stop "$1" >/dev/null
}

run_case redis-evict-test volatile-lru
run_case redis-evict-test-noeviction noeviction
