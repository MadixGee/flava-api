# Flava API

Backend scaffold for Flava, an Expo mobile app for emerging South African artists.

## Stack

- Node.js 22+
- TypeScript (strict mode)
- Fastify 5
- PostgreSQL 17
- Drizzle ORM + Drizzle Kit
- Zod environment validation
- Vitest

## Prerequisites

- Node.js 22 or newer
- Docker Engine / Docker Desktop with Compose

## Start locally

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

API runs at `http://localhost:3000` by default.

- `GET /` — service information
- `GET /health/live` — process liveness
- `GET /health/ready` — readiness including PostgreSQL connectivity

## Useful commands

```bash
npm run typecheck
npm test
npm run build
npm run db:generate
npm run db:migrate
npm run db:studio
```

## Project layout

```text
src/
  app.ts              Fastify app setup (also used by tests)
  server.ts           Runtime entry point and graceful shutdown
  config/env.ts       Validated environment configuration
  db/
    client.ts         PostgreSQL pool and Drizzle instance
    schema.ts         Drizzle schema
    migrate.ts        Run generated migrations
  routes/
    health.ts         Liveness and readiness endpoints
test/
  health.test.ts
```

## Architecture decisions

- Start as a modular monolith; no microservices for the MVP.
- The Expo app calls this API. Never put database credentials, SMS provider secrets, or object-storage credentials in the mobile app.
- Audio files should go directly to private object storage using short-lived signed upload URLs; the API should coordinate authorization and metadata, not proxy large audio uploads.
- OTP, sessions, recovery, artist profiles, catalogue, uploads, playback and moderation should be separate modules within this application as they are introduced.
- A verified `+27` number demonstrates control of a South African-numbered phone, not nationality or residency.
- Do not deploy with the example database password. Use managed secrets and a least-privilege database user in hosted environments.

## Next implementation slice

1. Define account and verified-phone tables, with phone numbers normalized to E.164.
2. Add an OTP provider adapter, request/verify endpoints, expiration, attempt limits, resend cooldowns and anti-abuse controls.
3. Add opaque server-side sessions with rotation and revocation.
4. Add recovery codes and a carefully audited account-recovery workflow before artists can accumulate valuable content.
5. Add artist profile APIs, then signed audio upload and track metadata.
