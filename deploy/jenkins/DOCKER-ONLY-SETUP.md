# Docker-only host (automated via Jenkinsfile)

The VM only needs **Docker** + **Jenkins**. Node and pnpm run **inside Docker** during the image build.

**Build Now** is the whole install. The first build creates `$JENKINS_HOME/meetcon/.env.production` and a self-signed certificate, then starts the stack on port 30098. The next build reuses those files.

A Jenkins **Secret file** named `meetcon-production-env` is optional. When it exists, that file is the production env.

See [README.md](README.md).

Legacy optional path: `MEETCON_SECRETS_DIR=/etc/meetcon` + `jenkins-load-secrets.sh` (not used when Jenkins credentials are configured).
