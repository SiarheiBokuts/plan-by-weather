# Spec Delta

## Purpose
Rank how suitable each of the next 7 days is for skiing, surfing, outdoor sightseeing and indoor sightseeing in a given city, with explainable scores.

## ADDED Requirements

### Requirement: Ranking query by city
The system SHALL expose a GraphQL query that accepts a city name and an optional country code, and returns the resolved location, a 7-day outlook for each of the four activities, and response metadata.

#### Scenario: Known city
- **WHEN** a client requests the ranking for "Innsbruck"
- **THEN** the response contains the resolved location (name, country, coordinates)
- **AND** contains one outlook for each of skiing, surfing, outdoor sightseeing and indoor sightseeing
- **AND** each outlook contains 7 daily entries starting from today in the location's local time zone

#### Scenario: Unknown city
- **WHEN** a client requests the ranking for a name that matches no location
- **THEN** the system returns a clear "location not found" error and makes no weather request

#### Scenario: Ambiguous city name
- **WHEN** a client requests a name that matches several places (for example "Paris")
- **THEN** the system uses the best-ranked populated place, returns which location it chose, and accepts a country code to pick a different one

#### Scenario: Country code narrows the match
- **WHEN** a client requests "Paris" with country code "US"
- **THEN** the resolved location is a Paris in the United States

#### Scenario: Input too short
- **WHEN** a client sends a name shorter than 2 characters
- **THEN** the system rejects it with a validation error and makes no upstream call

#### Scenario: Non-city results are ignored
- **WHEN** the geocoder returns an airport or other non-settlement feature before a town of the same name
- **THEN** the system chooses the town

#### Scenario: Alternate spelling
- **WHEN** a client requests a city by a local or alternate spelling (for example "Munchen")
- **THEN** it resolves to the same stored location as the common spelling

### Requirement: Daily score with reasons
The system SHALL compute, for every activity and day, an integer score from 0 to 100, a rating (POOR, FAIR, GOOD, GREAT) and a list of short human-readable reasons.

#### Scenario: Rainy day for outdoor sightseeing
- **WHEN** a day has significant precipitation
- **THEN** the outdoor sightseeing score is lower than on a dry day with the same temperature
- **AND** the reasons mention the precipitation

#### Scenario: Bad weather favours indoor sightseeing
- **WHEN** a day is rainy or very cold
- **THEN** the indoor sightseeing score is higher than on a mild, dry day

#### Scenario: No snow
- **WHEN** a day has no snow on the ground and no snowfall
- **THEN** the skiing score is low and the reasons say there is no snow

### Requirement: Plain-language description per day and activity
The system SHALL return, for every activity and day, a one-sentence summary in plain language that says what the weather is and why it is good or bad for that activity.

#### Scenario: Rain for sightseeing
- **WHEN** a day is rainy
- **THEN** the outdoor sightseeing summary says it is rainy and not great for walking around
- **AND** the indoor sightseeing summary says it is a good day for museums and indoor activities

#### Scenario: Sunny mild day
- **WHEN** a day is dry, sunny and mild
- **THEN** the outdoor sightseeing summary says the weather is good for exploring outside

### Requirement: Day-by-day view
The system SHALL also return the outlook grouped by day: for each of the next 7 dates, the score, rating and summary of every available activity, and which activity is best that day.

#### Scenario: Best activity of the day
- **WHEN** the response is requested for a location
- **THEN** each day lists all available activities with their scores
- **AND** names the activity with the highest score as that day's best activity

### Requirement: Unavailable activity
The system SHALL mark an activity as unavailable, with a reason, when the data it needs does not exist for the location, instead of reporting a score of zero.

#### Scenario: Surfing in an inland city
- **WHEN** wave data is not available for the location
- **THEN** the surfing outlook is flagged unavailable with the reason "no wave data for this location"
- **AND** the other three activities are still scored

### Requirement: Ordering and summary
The system SHALL order activities by their 7-day average score, highest first, and report for each activity the best day and a daily rank where 1 is the best day.

#### Scenario: Best day
- **WHEN** an activity has different scores across the 7 days
- **THEN** its `bestDay` is the date with the highest score
- **AND** that day has rank 1

### Requirement: Data provenance in every response
The system SHALL include in every ranking response where the data came from, when it was fetched, whether it is stale, and when the next refresh is allowed.

#### Scenario: First request for a city
- **WHEN** the weather for the location was just retrieved from Open-Meteo
- **THEN** the source is `OPEN_METEO`

#### Scenario: Repeat request within the refresh interval
- **WHEN** the same location is requested again before the refresh interval has elapsed
- **THEN** the source is `DATABASE` and the fetch time equals the earlier fetch time
