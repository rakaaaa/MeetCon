#!/usr/bin/env bash
set -eu
command -v docker >/dev/null || { echo "Docker not installed on Jenkins host." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Jenkins user cannot run docker. Add jenkins to group docker and restart Jenkins." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 plugin missing." >&2; exit 1; }
if [ "${MEETCON_CI_ONLY:-}" != "1" ]; then
  command -v openssl >/dev/null || {
    echo "openssl required for auto TLS (deploy/certs). Install openssl on the Jenkins host." >&2
    exit 1
  }
fi
echo "Docker preflight OK."
