# Spec Delta

## Purpose
React correctly when Open-Meteo refuses requests because the free-tier allowance is used up: stop making calls that are known to fail, serve stored data when possible, and tell users plainly and with an approximate wait time when new data cannot be loaded.

## ADDED Requirements

### Requirement: Pause after an upstream rate-limit answer
The system SHALL pause all calls to Open-Meteo when it answers that too many requests were made, until the time the upstream indicates, or for a default of 15 minutes when it gives none.

#### Scenario: Upstream says too many requests
- **WHEN** Open-Meteo answers with a rate-limit status
- **THEN** the system records when calls may resume
- **AND** makes no further upstream calls until that time

#### Scenario: Pause is shared
- **WHEN** one instance records a pause
- **THEN** other instances also stop calling the upstream

#### Scenario: Pause ends
- **WHEN** the recorded time has passed
- **THEN** the next refresh calls the upstream normally

### Requirement: Existing data wins over an error
The system SHALL answer with stored data marked stale when calls are paused and the requested location has stored data.

#### Scenario: Known city while paused
- **WHEN** calls are paused and the requested city has stored weather
- **THEN** the response contains that weather with `stale` true and the time when a refresh will be possible

### Requirement: Clear error for a new city
The system SHALL return a dedicated error when calls are paused and the requested city has no stored weather, containing a user-friendly message and an approximate retry time.

#### Scenario: New city while paused
- **WHEN** calls are paused and the requested city has no stored weather
- **THEN** the error code is `OPEN_METEO_RATE_LIMITED`
- **AND** the message reads along the lines of "We can't load weather for this city right now. Please try again in about 15 minutes."
- **AND** the error carries the retry time in seconds

### Requirement: Distinguishable errors
The system SHALL return distinct, machine-readable error codes for: location not found, client rate limit exceeded, Open-Meteo rate limited, and Open-Meteo unavailable.

#### Scenario: Different failures
- **WHEN** each of those four situations occurs
- **THEN** each produces a different error code and a message safe to show to a user
