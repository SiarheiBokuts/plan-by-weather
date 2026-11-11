// Tests run against real Postgres and Redis. Compose sets these; the defaults match
// `docker compose up -d postgres redis` when running Jest from the host.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://weather:weather@localhost:54329/weather?schema=test';
process.env.REDIS_URL ??= 'redis://localhost:63799/1';
