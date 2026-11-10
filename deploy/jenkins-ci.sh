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

secrets_dir="${MEETCON_SECRETS_DIR:-${JENKINS_HOME:-$HOME}/meetcon}"
ready_file="${secrets_dir}/.db-ready"
if [ ! -f "$ready_file" ] || truthy "${MEETCON_WIPE:-}"; then
  echo "Removing the previous MeetPlus install (containers, database, and saved settings)."
  docker ps -aq --filter label=com.docker.compose.project=meetcon-prod | xargs -r docker rm -f || true
  docker ps -aq --filter label=com.docker.compose.project=meetcon-sim | xargs -r docker rm -f || true
  docker volume ls -q --filter label=com.docker.compose.project=meetcon-prod | xargs -r docker volume rm -f || true
  docker volume ls -q --filter label=com.docker.compose.project=meetcon-sim | xargs -r docker volume rm -f || true
  docker volume rm -f meetcon-prod_postgres_data meetcon-prod_redis_data meetcon-prod_media_data >/dev/null 2>&1 || true
  docker network ls -q --filter label=com.docker.compose.project=meetcon-prod | xargs -r docker network rm || true
  docker network ls -q --filter label=com.docker.compose.project=meetcon-sim | xargs -r docker network rm || true
  rm -rf "$secrets_dir"
  mkdir -p "$secrets_dir"
  chmod 700 "$secrets_dir"
  export SKIP_DB_BACKUP=1
fi

bash deploy/jenkins-write-secrets.sh

if command -v ufw >/dev/null 2>&1; then
  sudo -n ufw allow 30098/tcp || echo "WARN: could not open TCP 30098 on the VM. If the site is unreachable, run: sudo ufw allow 30098/tcp" >&2
fi

if truthy "${MEETCON_ISOLATED_SIM:-}"; then
  bash deploy/meetcon.sh simulate
  exit 0
fi

bash deploy/meetcon.sh run
touch "$ready_file"
