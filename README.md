# Flava API

Backend scaffold for Flava, an Expo mobile app for emerging South African artists.

## Stack

- Node.js 22+
- TypeScript (strict mode)
- Express 5
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

Interactive Swagger docs are served at `http://localhost:3000/docs`. `POST /auth/email/signup` returns
`200` (user created), `400` (invalid email or password) or `409` (email already registered).

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
  app.ts              Express app setup (also used by tests)
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

## Authentication

The first authentication slice provides email/password signup and login, email
verification, password reset, short-lived JWT access tokens, rotating opaque
refresh tokens, logout/revocation, and per-user session listing/revocation.
OAuth, phone OTP, and phone-number changes are not implemented yet. Lost-phone
recovery is support-managed; there is no self-service phone recovery.

Set `AUTH_JWT_SECRET` to a cryptographically random value of at least 32
characters. Email verification and password-reset messages require all SMTP
settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`);
delivery errors are logged without logging the email token. In production,
SMTP settings are mandatory. Access tokens expire after 15 minutes by default,
refresh tokens after 30 days, and email tokens after 60 minutes; these values
can be changed with the corresponding `AUTH_*_TTL_*` environment variables.
Passwords require at least 8 characters, and auth endpoints are rate limited by
IP and (where applicable) normalized email using PostgreSQL-backed counters.

Run `npm run db:generate` and `npm run db:migrate` after configuring
`DATABASE_URL`. Signup currently creates a neutral `New listener` profile and
generated username because profile completion belongs to a later API slice.

## Next implementation slices

1. Add a transactional email outbox and configurable email delivery workflows.
2. Add verified phone identities and an OTP provider adapter, with expiration, attempt limits, resend cooldowns and anti-abuse controls.
3. Add verified Google and Facebook identity linking.
4. Add phone-number change, payout cooldown, and carefully audited lost-phone support workflows.
5. Add artist profile APIs, then signed audio upload and track metadata.
