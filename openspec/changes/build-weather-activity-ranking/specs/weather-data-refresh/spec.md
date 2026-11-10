# Spec Delta

## Purpose
Persist weather data per location and refresh it from Open-Meteo no more often than a configured interval, protecting the free-tier quota and keeping responses fast.

## ADDED Requirements

### Requirement: Persisted locations
The system SHALL store each resolved location once and reuse it for later requests, so the same place is not geocoded repeatedly.

#### Scenario: Same city requested twice
- **WHEN** a city is requested a second time
- **THEN** no geocoding request is made

### Requirement: Persisted daily weather
The system SHALL store normalized daily weather for the next 7 days per location, including temperature, precipitation, snowfall, snow depth, wind, weather condition, and wave height and period when available.

#### Scenario: Refresh replaces old data
- **WHEN** a location is refreshed
- **THEN** its stored daily rows are updated for the returned dates and rows for past dates are removed

### Requirement: Minimum refresh interval
The system SHALL NOT call Open-Meteo for a location's forecast again until the configured refresh interval (default 6 hours) has elapsed since its last successful fetch.

#### Scenario: Fresh data
- **WHEN** a location was fetched less than the interval ago
- **THEN** the system answers from the database without any upstream call

#### Scenario: Expired data
- **WHEN** a location was fetched more than the interval ago
- **THEN** the system fetches new data, stores it, and answers with the new data

### Requirement: Single upstream call for concurrent requests
The system SHALL ensure that concurrent requests for the same expired location cause at most one upstream fetch.

#### Scenario: Ten simultaneous requests
- **WHEN** ten requests for the same expired location arrive at the same time
- **THEN** exactly one upstream forecast call is made
- **AND** all ten requests receive a response

### Requirement: Stale fallback
The system SHALL serve previously stored data, marked stale, when a refresh fails, and SHALL return an error only when no stored data exists.

#### Scenario: Upstream is down but data exists
- **WHEN** Open-Meteo fails and the location has stored data
- **THEN** the response is returned with `stale` set to true

#### Scenario: Upstream is down and no data exists
- **WHEN** Open-Meteo fails and the location has no stored data
- **THEN** the system returns a service-unavailable error with a retry hint

### Requirement: Bounded storage
The system SHALL keep the number of stored locations below a configured maximum by removing the least recently requested location, together with its weather data, when a new one would exceed the maximum.

#### Scenario: Cap reached
- **WHEN** the maximum number of locations is stored and a new location is requested
- **THEN** the least recently requested location and its weather data are removed
- **AND** the new location is stored and answered normally

#### Scenario: Evicted city requested again
- **WHEN** a client later requests a location that was removed
- **THEN** it is resolved and fetched again as a new location

### Requirement: Disposable shared cache
The system SHALL give every entry in the shared cache an expiry and SHALL keep working, with at worst a fresh rate-limit window or a repeated database check, if cache entries are evicted under memory pressure.

#### Scenario: Cache memory full
- **WHEN** the shared cache reaches its memory limit
- **THEN** the oldest expiring entries are evicted and new writes still succeed

### Requirement: Wave data availability
The system SHALL treat a marine response that contains no values as "no wave data" for the location, not as an error.

#### Scenario: Inland location
- **WHEN** the marine response for a location contains only empty values
- **THEN** the location is recorded as having no wave data and surfing is reported unavailable
