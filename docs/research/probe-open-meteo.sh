#!/usr/bin/env bash
# Re-runs the checks behind docs/research/open-meteo-findings.md against the live API.
# Usage: bash docs/research/probe-open-meteo.sh
set -u

geo() {
  curl -s -m 15 "https://geocoding-api.open-meteo.com/v1/search?$1" | python3 -c "
import sys, json
d = json.load(sys.stdin); r = d.get('results') or []
print('  results:', len(r))
for x in r[:5]:
    print('  ', x['name'], '|', x.get('country_code'), '|', x.get('admin1'), '| pop', x.get('population'), '| feature', x.get('feature_code'))"
}

cost() {
  curl -s -m 20 -D - -o /dev/null "$1" | tr -d '\r' | grep -iE '^(x-ratelimit-(cost|remaining|limit|window))' | tr '\n' ' '
  echo
}

DAILY4="daily=temperature_2m_max,precipitation_sum,snowfall_sum,wind_speed_10m_max&forecast_days=7&timezone=auto"
F="https://api.open-meteo.com/v1/forecast"

echo "== Geocoding: ambiguity, filters, edge cases"
for q in "name=Paris&count=5" "name=Paris&count=5&countryCode=US" "name=Springfield&count=5" \
         "name=Zermatt&count=3" "name=Munchen&count=3" "name=Lond&count=3" "name=asdfqwer&count=3" "name=P&count=3"; do
  echo "$q"; geo "$q&language=en"
done

echo "== Rate-limit cost per request shape (header X-RateLimit-Cost)"
echo "1 location:";   cost "$F?latitude=47.26&longitude=11.39&$DAILY4"
echo "3 locations:";  cost "$F?latitude=47.26,48.14,43.48&longitude=11.39,11.58,-1.56&$DAILY4"
echo "10 locations:"; cost "$F?latitude=47.26,48.14,43.48,48.85,52.52,51.5,41.9,40.4,59.3,55.7&longitude=11.39,11.58,-1.56,2.35,13.4,-0.12,12.5,-3.7,18.07,37.6&$DAILY4"
echo "1 location, 12 daily + 2 hourly:"
cost "$F?latitude=47.26&longitude=11.39&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,weather_code,sunshine_duration,uv_index_max,cloud_cover_mean&hourly=snow_depth,temperature_2m&forecast_days=7&timezone=auto"
echo "(spends a few API calls of the free allowance; do not loop it)"
