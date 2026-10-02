# Jenkins — run MeetCon

## Setup (once)

1. **Git** on the job: repo URL, branch `main`, credentials = GitHub username + PAT.
2. **Secret file** credential, ID **`meetcon-production-env`**, file = your `.env.production` (from `.env.production.example`).
3. **Docker** on the Jenkins host; `jenkins` in the `docker` group.

## Each build

**Checkout** → **Deploy** (`deploy/jenkins-ci.sh`):

1. Write `.env.production` from Jenkins  
2. `docker compose up --build` on **VM port 30098**  
3. Doctor (health on `https://127.0.0.1:30098/health`)  
4. **Smoke test** on the same port (`/health` + SPA). No second stack on 30998.

## Env file essentials

```env
GATEWAY_PUBLIC_PORT=30098
WEB_ORIGIN=https://your-hostname:30098
```

`WEB_ORIGIN` **must** include `:30098` (or your custom `GATEWAY_PUBLIC_PORT`).

## Optional job environment

| Variable | Effect |
|----------|--------|
| `MEETCON_CI_ONLY=true` | Docker check only |
| `MEETCON_SKIP_SMOKE=1` | Deploy without smoke script |
| `MEETCON_SMOKE_FULL=1` | Smoke also registers a test user (API + cookies) |
| `MEETCON_ISOLATED_SIM=1` | Old flow: separate stack on `127.0.0.1:30998` |
| `MEETCON_CI_BUILD=1` | Extra pnpm build in Node container before compose |

## Without Jenkins

```bash
cp .env.production.example .env.production   # edit
./deploy/meetcon.sh run
```
