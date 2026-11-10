# Jenkins — fresh install and later deploys

One **Build Now** on the built-in node installs MeetPlus in Docker and leaves it on HTTPS port **30098**.

The job checks out this repo, prepares `.env.production` and a TLS certificate, builds the images, runs migrations, and checks `/health` plus the web app.

## What you need on the VM

- Jenkins uses the **built-in** node (the agent label in `Jenkinsfile`).
- Docker Engine and Compose v2 are installed.
- The `jenkins` user can run Docker (`sudo usermod -aG docker jenkins`, then restart Jenkins).
- The job loads this repo from Git (branch `main`).

## First build

Click **Build Now**. No secret file is required.

The first build removes any previous MeetPlus containers, database volume, and saved settings, then installs a new one. After that build succeeds, later builds keep the database. Set `MEETCON_WIPE=1` only when you intend to delete that database and install again.

The first build writes:

- `$JENKINS_HOME/meetcon/.env.production`
- `$JENKINS_HOME/meetcon/fullchain.pem` and `privkey.pem` (self-signed)

The site URL is the `WEB_ORIGIN` line in that file. The default host comes from `.env.production.example`. To choose the host before the first build, set the job environment variable `MEETCON_PUBLIC_HOST` to the public hostname.

Later builds reuse those files, so the database password does not change. The Jenkins workspace is wiped every build; the saved files are not.

The certificate is self-signed, so the browser shows a warning until you replace the two `.pem` files with a real certificate and build again.

## Optional: bring your own env

Create a **Secret file** credential with ID `meetcon-production-env` whose content is a finished `.env.production`. When that credential exists, the job uses it instead of generating one.

`WEB_ORIGIN` is `https://meetcon.aiadoptionecosystem.com` with no port. Docker listens on port `30098` behind that name. `DATABASE_URL` must use the Docker host `postgres` with the same password as `POSTGRES_PASSWORD`.

LinkedIn sign-in reads two **Secret text** credentials. Create them in Jenkins and paste the values from your local `.env`. Do not commit those values.

| Credential ID | Value |
|---------------|--------|
| `meetcon-linkedin-client-id` | `LINKEDIN_CLIENT_ID` |
| `meetcon-linkedin-client-secret` | `LINKEDIN_CLIENT_SECRET` |

Also register this redirect URL on the LinkedIn app: `https://meetcon.aiadoptionecosystem.com/api/auth/linkedin/callback`

## Optional job environment

| Variable | Effect |
|----------|--------|
| `MEETCON_PUBLIC_HOST` | Hostname used the first time an env file is created |
| `MEETCON_CI_ONLY=true` | Docker check only, no install |
| `MEETCON_SKIP_SMOKE=1` | Install without the smoke script |
| `MEETCON_SMOKE_FULL=1` | Smoke also registers a test user |
| `MEETCON_ISOLATED_SIM=1` | Practice stack on `127.0.0.1:30998` instead of production |
