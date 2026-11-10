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

bash deploy/meetcon.sh run
