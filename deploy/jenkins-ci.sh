#!/usr/bin/env bash
# Jenkins: preflight → deploy on VM :30098 → doctor → smoke (no separate :30998 stack by default).
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
chmod +x deploy/meetcon.sh deploy/certs/*.sh 2>/dev/null || true

truthy() {
  case "${1:-}" in 1|true|yes|on|TRUE|YES|ON) return 0 ;; *) return 1 ;; esac
}

bash deploy/jenkins-docker-preflight.sh

if truthy "${MEETCON_CI_BUILD:-}"; then
  bash deploy/jenkins-docker-build.sh
fi

if truthy "${MEETCON_CI_ONLY:-}"; then
  echo "MEETCON_CI_ONLY — done (no deploy)."
  exit 0
fi

bash deploy/jenkins-write-secrets.sh

port="$(grep -E '^GATEWAY_PUBLIC_PORT=' .env.production | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
port="${port:-30098}"
if command -v ufw >/dev/null 2>&1; then
  sudo -n ufw allow "${port}/tcp" || echo "WARN: could not open TCP ${port}. If the site is unreachable, run: sudo ufw allow ${port}/tcp" >&2
fi

if truthy "${MEETCON_ISOLATED_SIM:-}"; then
  bash deploy/meetcon.sh simulate
  exit 0
fi

ready_file="${MEETCON_SECRETS_DIR:-${JENKINS_HOME:-$HOME}/meetcon}/.db-ready"
if [ ! -f "$ready_file" ]; then
  echo "Fresh install: removing the unused Postgres volume so the database is created with the current password."
  export SKIP_DB_BACKUP=1
  COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file .env.production -f docker-compose.prod.yml -p meetcon-prod down --remove-orphans || true
  docker volume rm -f meetcon-prod_postgres_data >/dev/null 2>&1 || true
  docker volume ls -q \
    --filter label=com.docker.compose.project=meetcon-prod \
    --filter label=com.docker.compose.volume=postgres_data \
    | while read -r vol; do
      [ -n "$vol" ] && docker volume rm -f "$vol" || true
    done || true
fi

bash deploy/meetcon.sh run
touch "$ready_file"
