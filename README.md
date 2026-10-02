# MeetCon

MeetCon is a pnpm monorepo for server-authoritative timed meetups. The backend
uses Fastify, TypeScript, PostgreSQL, Redis pub/sub, secure cookie sessions,
Argon2, Zod, multipart image uploads, and SMTP.

## Prerequisites

- Node.js 20 or newer
- Corepack (included with standard Node.js 20 installations)
- Docker Desktop or another Docker installation with Compose v2

If `node`, `corepack`, or `docker compose` is unavailable, install or enable the
missing prerequisite and ensure it is on `PATH`. Docker must be running before
the startup script is used.

## Quick start

**Single command** (validates prerequisites, starts Docker services, migrates, runs API + web):

```sh
node run.mjs
```

Or use any of these equivalents:

| Platform | Command |
|----------|---------|
| Any (recommended) | `corepack pnpm start` |
| Windows | `run.bat` |
| macOS / Linux | `chmod +x run.sh && ./run.sh` |

The script is safe to run repeatedly. It:

1. Validates Node.js 20+, Docker, and Compose v2.
2. Creates `.env` from `.env.example` only when `.env` does not exist.
3. Installs packages with the pinned Corepack-managed pnpm version.
4. Starts PostgreSQL 16, Redis 7, and Mailpit and waits until they are healthy.
5. Runs database migrations.
6. Starts the API and web dev servers (`pnpm dev`).

When startup finishes, open the **web app** at `http://localhost:5173` (or your
`WEB_ORIGIN` in `.env`).

The API is available at `http://localhost:3001`; health is at `/health`.

## Services

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Mailpit SMTP: `localhost:1025`
- Mailpit UI: <http://localhost:8025>

Values can be changed in `.env`. Existing `.env` files are never overwritten by
the startup scripts.

## Workspace layout

- `apps/api` — Fastify API, SQL migrations, media adapter, and maintenance jobs
- `apps/web` — React/Vite admin and participant web application
- `apps/android` — Kotlin/Compose hardened WebView shell
- `packages/shared` — Zod schemas, inferred API types, and shared utilities

## Commands

Run commands through Corepack to ensure the pinned pnpm version is used:

```sh
corepack pnpm dev
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm migrate
```

## Stack verification

These are stack-level checks, not unit tests. Both commands require a running
Docker daemon with Compose v2. They start PostgreSQL, Redis, and Mailpit, apply
migrations, launch the required application processes, and fail early with a
clear prerequisite message when Docker is unavailable.

Install the Playwright Chromium browser once before the browser checks:

```sh
corepack pnpm exec playwright install chromium
```

Run the real API integration scenario:

```sh
corepack pnpm test:integration
```

It registers two admins and two participants and verifies owner isolation,
meetup creation, code/link joining and join idempotency, server-timed active
questions, immutable/idempotent answers, selected-count privacy, a question
boundary transition, completion, and owner-grouped results against PostgreSQL,
Redis, and the running API.

Run browser smoke and workflow checks:

```sh
corepack pnpm test:e2e
```

Playwright runs Chromium in desktop and mobile viewport projects. It covers the
public authentication routes plus key admin creation and participant joining
flows, and treats uncaught page errors, console errors, failed requests, and
HTTP 5xx responses as failures. To point an already configured invocation at
other endpoints, set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_API_URL`.

## Backend

Copy `.env.example` to `.env` and replace `TOKEN_ENCRYPTION_KEY` outside local
development. Generate it with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run `corepack pnpm migrate` after PostgreSQL is healthy. Migrations are
checksummed and serialized with a PostgreSQL advisory lock.

The API exposes:

- Registration, login/logout/session restoration, password reset, and password change
- Profile editing, image upload/removal, theme/time-zone settings, and anonymized deletion
- Owner-isolated draft/published meetup CRUD with version checks and four-option questions
- Code/token invitation preview and idempotent participant joining
- Joined meetup lists, server-authoritative active state, immutable answers, and selected-option SSE
- Owner-only grouped results and CSV exports

## Production website (port 30098)

For an Ubuntu VM with Docker, use the production stack documented in
[`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md). It exposes **only** HTTPS port
`30098` on the gateway, serves the React build, and proxies `/api` and `/media` to
the internal API.

Quick start on the VM:

```sh
cp .env.production.example .env.production
# edit secrets and set WEB_ORIGIN=https://your-domain:30098
# add deploy/certs/fullchain.pem and deploy/certs/privkey.pem
chmod +x deploy/meetcon.sh
./deploy/meetcon.sh up
```

Or: `corepack pnpm deploy:up`. Ops guide: [`deploy/README.md`](deploy/README.md). Jenkins: **Build Now** ([`deploy/jenkins/README.md`](deploy/jenkins/README.md)).

Files added for production:

- [`docker-compose.prod.yml`](docker-compose.prod.yml) — gateway, API, migrate, PostgreSQL, Redis
- [`apps/api/Dockerfile`](apps/api/Dockerfile) — API image
- [`deploy/gateway/Dockerfile`](deploy/gateway/Dockerfile) — Nginx + static web build on `:30098`
- [`deploy/nginx.conf`](deploy/nginx.conf) — SPA, SSE-friendly `/api` proxy, TLS
- [`.env.production.example`](.env.production.example) — template environment

Session cookies are `Secure` in production. Keep `WEB_ORIGIN` identical to the
public URL including `:30098` so QR links, reset emails, and cookies stay consistent.
The Android release app uses the same origin in a full-screen WebView with no URL bar.

Forgot-password mail is captured locally at <http://localhost:8025>. Expired
sessions and reset tokens are cleaned hourly while the API is running.

To stop local services:

```sh
docker compose down
```

Add `--volumes` to that command only when you intentionally want to delete
local PostgreSQL and Redis data.
