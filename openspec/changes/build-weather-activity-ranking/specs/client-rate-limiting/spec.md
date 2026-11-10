# Spec Delta

## Purpose
Limit how many requests a single anonymous client can make so one client cannot exhaust the service or the shared Open-Meteo quota.

## ADDED Requirements

### Requirement: Per-client request limit
The system SHALL limit requests per client within a time window, identifying the client by an `x-api-key` header when present and otherwise by network address, without requiring authentication.

#### Scenario: Within the limit
- **WHEN** a client sends fewer requests than the limit in the window
- **THEN** all requests are processed normally

#### Scenario: Limit exceeded
- **WHEN** a client exceeds the limit in the window
- **THEN** the system rejects further requests with a rate-limit error that tells the client when to retry
- **AND** no upstream call is made for rejected requests

### Requirement: Limits are shared across instances
The system SHALL keep limit counters in shared storage so the limit holds when more than one instance runs.

#### Scenario: Two instances
- **WHEN** one client's requests are spread across two instances
- **THEN** the combined count is used against the limit

### Requirement: Degrade instead of fail
The system SHALL keep serving requests, with a logged warning, if the shared storage for limits is unavailable.

#### Scenario: Limit storage down
- **WHEN** the shared storage is unreachable
- **THEN** requests are still served and a warning is logged
