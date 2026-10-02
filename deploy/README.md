# MeetCon production maintenance

Small-team stack: **Docker Compose** on one VM, **HTTPS :30098**, Postgres + Redis + API + Nginx gateway. App code is unchanged (Fastify API, React web, migrations, SSE, auth, media).

## One CLI

```bash
chmod +x deploy/meetcon.sh
./deploy/meetcon.sh help
```

| Command | When to use |
|---------|-------------|
| `up` | First-time or manual start |
| `deploy` | Jenkins / CI (backup + rebuild + health) |
| `backup` | Manual DB dump to `backups/` |
| `doctor` | Quick check after deploy |
| `doctor --full` | Deep check (API, Redis, Postgres, gateway, port 30098) |
| `simulate` | **Pre-prod dry run** — isolated Docker project `meetcon-sim` on `127.0.0.1:30998`, app smoke test, then tear down |
| `firewall` | `ufw allow` gateway port |
| `toolchain` | Node + pnpm (Jenkins build step) |

## Pipeline simulation (avoids production surprises)

Jenkins **Build Now** runs: **Build** → **Simulate** → **Deploy production**.

Simulation uses separate volumes and `.env.simulation` — **does not** backup or restart the `:30098` production stack.

```bash
pnpm build && pnpm simulate   # manual rehearsal
```

Job env overrides:

| Variable | Default | Effect |
|----------|---------|--------|
| `MEETCON_SKIP_SIMULATE` | `false` | `true` = skip simulation (not recommended) |
| `MEETCON_SIMULATE_ONLY` | `false` | `true` = simulate only, no prod deploy |
| `MEETCON_CI_ONLY` | `false` | `true` = compile only |

Wrappers (`up.sh`, `deploy-from-ci.sh`, …) call the same CLI.

## One-time VM setup

1. `cp .env.production.example .env.production` — set `WEB_ORIGIN=https://<host>:30098`
2. TLS: `deploy/certs/fullchain.pem`, `privkey.pem`
3. `./deploy/meetcon.sh up`
4. Jenkins **built-in node** on the VM → **Build Now** ([jenkins/README.md](jenkins/README.md))

## Stack (what runs in prod)

```
Browser → :30098 gateway (nginx + SPA) → api:3001 → postgres, redis
```

No Kubernetes. No separate web container in prod (web is built into the gateway image).

## Optional / advanced

- [`validate-production-stack.sh`](validate-production-stack.sh) — full validation (used by `doctor --full`)
- [`diagnose-gateway-port.sh`](diagnose-gateway-port.sh) — port mapping diagnostics
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — architecture and rollback
- `apps/web/Dockerfile` — optional static-only image (not used by default prod compose)
