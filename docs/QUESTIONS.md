# Open questions and the assumption I went with

The brief says to note, instead of block on, the questions I would normally put to a product manager.
Each row: the question, what I assumed, and what changes if the answer is different.

| # | Question for product | Assumption taken | If the answer differs |
|---|---|---|---|
| 1 | What does "rank" mean: order the four activities, or order the days? | Both. `byActivity` orders activities by their weekly score and ranks the days inside each; `byDay` gives each day's activities and the best one. | Drop one view; both come from one scored matrix, so this is a small change. |
| 2 | Can the four scores be compared with each other? | Roughly. Every score uses the same 0-100 bands (POOR/FAIR/GOOD/GREAT) and ordering activities by weekly average is a convenience, not a claim that 70 skiing equals 70 museums. | Return only per-activity rankings, no cross-activity order. |
| 3 | Skiing happens on the slopes of a resort, but the user gives a town. Whose weather do we judge? | The weather at the town's own coordinates. In a valley town without snow, skiing scores low even if the slopes above are snowy. The README lists this as a limitation. | Find ski resorts near the town and score the weather at their coordinates and altitude instead (future work). |
| 4 | What if the data does not exist (surfing inland)? | The activity is `available: false` with a reason, not a score of 0. | Return 0 or hide the activity. |
| 5 | An ambiguous name ("Paris")? | Best-ranked town or city; the answer shows which was chosen; `countryCode` overrides; `searchLocations` lists candidates. | Return an error asking the user to choose when several large places match. |
| 6 | What is "the next 7 days"? | Today plus six days, in the city's own time zone. | Use the caller's time zone, or start tomorrow. |
| 7 | How fresh must data be? | Refreshed at most every 6 hours per city (Open-Meteo models update every 1-6 hours). Configurable. | Change `FORECAST_TTL_HOURS`. |
| 8 | Who is a "user" when there is no login? | `x-api-key` header if sent, otherwise IP address. 60 requests/minute each. | Real authentication and per-plan limits. |
| 9 | What should a user see when the free allowance is used up? | Known cities: stored data marked `outdated`. New cities: a clear error with an approximate wait. | Queue the request and answer later, or notify the user. |
| 10 | Units and language? | Metric (°C, mm, km/h, cm); English text. | Add a units argument and translations. |
| 11 | Is the free Open-Meteo tier acceptable for this product? | Yes for a demo. It is non-commercial only. | A paid plan removes the quota concern entirely. |
| 12 | How many cities may we keep? | All of them: no cap (a city is about 2 KB). Cleaning old data by age is a planned improvement. | Add the cleanup, or a cap if storage ever matters. |
