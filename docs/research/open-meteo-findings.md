# Open-Meteo findings

Checked against the live API on 2026-11-10 while planning. Raw responses are the recorded fixtures in `test/fixtures/`.

## Limits (free tier)

600 calls/min, 5,000/hour, 10,000/day, 300,000/month; non-commercial use only; no uptime guarantee. Source: open-meteo.com/en/pricing. Responses include `X-RateLimit-Limit`, `-Remaining`, `-Cost`, `-Window` (the window seen was 60 s).

## What a request costs

Measured through the `X-RateLimit-Cost` header on the forecast API:

| Request | Cost |
|---|---|
| 1 location, 4 daily variables | 1.0 |
| 1 location, 4 daily variables + hourly `snow_depth` | 1.0 |
| 3 locations in one request | 3.0 |
| 10 locations in one request | 10.0 |
| 1 location, 16 forecast days (one variable) | 1.0 |
| 1 location, 12 daily variables + 2 hourly variables | 1.4 |

**Cost is per location, not per request.** Batching cities into one request saves HTTP round trips, not quota. Cost grows with the number of variables, so request only what the scorers use. The marine API returns no rate-limit headers at all, and two marine calls made between two forecast calls did not change the forecast host's `X-RateLimit-Remaining` (599 then 598, one forecast call apart each). The headers therefore prove nothing either way. Open-Meteo's terms say limits are applied "by IP addresses and application" and its pricing FAQ says one API call "typically corresponds to one HTTP API request"; nothing exempts the marine API. **We assume marine calls count against the same allowance** (the cautious reading), which is why inland cities skip them after the first check.

Version one makes one call per location. Batching is listed as a future improvement (useful for a background refresh job).

## Geocoding

- Results are relevance-ranked (population-weighted). "Paris" returns France first, then Texas and Tennessee.
- `countryCode` (ISO alpha-2) narrows results; "Paris" + `US` returns Texas first.
- **The geocoder matches names in the language it is asked to answer in.** "Минск" with `language=ru` finds Minsk, Belarus first; with `language=en` it finds only a village called Minskoye in Russia (samples: `geocoding-minsk-ru.json`, `geocoding-minsk-en.json`). "Москва", "Гродно" and "Париж" behave the same. Ukrainian ("Київ") and Belarusian-only ("Мінск") spellings are not found in either language.
- Local and alternate spellings work ("Минск" gives Minsk BY, "Munchen" gives Munich). Matching is by prefix ("Lond" gives London).
- One character or gibberish returns `{"generationtime_ms": ...}` with **no `results` field**, not an error.
- Results include non-city features (an airport next to Zermatt, tiny hamlets); filter on feature code `PPL*`.
- Each result has id, coordinates, elevation, time zone, country code, region, population.

## Forecast

- `daily` block has temperature, apparent temperature, precipitation (sum and probability), snowfall, wind and gusts, weather code, sunshine duration (seconds), UV, cloud cover mean. Wind is km/h.
- `snow_depth` exists only as `hourly` (168 values for 7 days); aggregate it ourselves.
- `timezone=auto` makes `daily.time` local dates of the location.

## Marine

- Separate host (`marine-api.open-meteo.com`).
- Inland points answer **HTTP 200 with all-null arrays** (see `test/fixtures/marine/munich-inland.json`), not an error.
- Coastal requests are snapped to the nearest sea point (Biarritz 43.48 became 43.54).
