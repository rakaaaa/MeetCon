# Docker-only host (automated via Jenkinsfile)

The VM only needs **Docker** + **Jenkins**. Node/pnpm run **inside Docker** during the pipeline.

Secrets are **not** placed on the VM manually. They live in **Jenkins credentials** and are written each build by `deploy/jenkins-write-secrets.sh` (called from `Jenkinsfile`).

See [README.md](README.md) for credential IDs and **Build Now**.

Legacy optional path: `MEETCON_SECRETS_DIR=/etc/meetcon` + `jenkins-load-secrets.sh` (not used when Jenkins credentials are configured).
