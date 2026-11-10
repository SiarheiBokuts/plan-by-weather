# Spec Delta

## Purpose
Let a reviewer clone the repository, start the whole stack, run the tests and explore the API with one command each and nothing installed except Docker.

## ADDED Requirements

### Requirement: One-command start
The system SHALL start fully, including its database and cache and with the database schema applied, using a single `docker compose up --build` command.

#### Scenario: Fresh clone
- **WHEN** a reviewer runs the command in a fresh clone
- **THEN** the GraphQL endpoint answers on `http://localhost:3000/graphql` once the stack is healthy

### Requirement: One-command tests
The system SHALL run its full automated test suite with a single `docker compose run --rm tests` command.

#### Scenario: Running tests
- **WHEN** a reviewer runs the command
- **THEN** unit, service and end-to-end tests run against real Postgres and Redis, with Open-Meteo replaced by recorded responses
- **AND** the command exits non-zero if any test fails

### Requirement: Interactive API explorer
The system SHALL serve an interactive GraphQL explorer with schema documentation at `/graphql`, including when running in the container image.

#### Scenario: Open the endpoint in a browser
- **WHEN** a reviewer opens `http://localhost:3000/graphql`
- **THEN** an explorer is shown where the schema can be browsed and queries can be run

### Requirement: Importable request collection
The repository SHALL include a Postman collection with sample requests for a first fetch, a repeat fetch, a location search and an inland city.

#### Scenario: Import
- **WHEN** the collection file is imported into Postman
- **THEN** the sample requests run against a locally started stack without edits

### Requirement: Health check
The system SHALL expose a health endpoint that reports whether the database and cache are reachable.

#### Scenario: Healthy stack
- **WHEN** the health endpoint is requested while both dependencies are up
- **THEN** it reports healthy
