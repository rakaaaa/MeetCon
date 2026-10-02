# TLS files for the production gateway (not committed)

## Why MeetCon needs these

The production **gateway** serves the website on **HTTPS port 30098** (`deploy/nginx.conf` uses `listen 30098 ssl`). Docker mounts `fullchain.pem` and `privkey.pem` into that container. The API stays on the internal network; browsers only talk HTTPS to the gateway.

`WEB_ORIGIN` must match (`https://your-host:30098`) so session cookies and CORS work.

**Jenkins:** upload the same two files as Secret file credentials `meetcon-tls-fullchain` and `meetcon-tls-privkey` (see `deploy/jenkins/README.md`).

**Lab / self-signed:** `./generate-self-signed.sh your.hostname`

Place your certificate files here before starting production manually:

| File | Purpose |
|------|---------|
| `fullchain.pem` | Certificate chain (server + intermediates) |
| `privkey.pem` | Private key |

Example permissions on the VM:

```sh
chmod 700 deploy/certs
chmod 600 deploy/certs/privkey.pem
chmod 644 deploy/certs/fullchain.pem
```

Port **30098** uses HTTPS directly on the gateway container. Standard ACME HTTP-01 challenges on port 80 will not work unless you obtain the certificate separately (corporate CA, DNS-01, or a one-time cert issued elsewhere).

After files are in place:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Open `https://your-domain:30098` and confirm `/health` returns JSON through the gateway.
