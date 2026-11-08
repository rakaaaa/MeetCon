#!/usr/bin/env bash
# Writes production files from Jenkins withCredentials (env vars set by Jenkinsfile).
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -z "${MEETCON_ENV_FILE:-}" ] || [ ! -f "$MEETCON_ENV_FILE" ]; then
  echo "Missing Jenkins credential file: MEETCON_ENV_FILE (meetcon-production-env)" >&2
  exit 1
fi

install -m 600 -D "$MEETCON_ENV_FILE" .env.production
bash deploy/validate-production-env.sh .env.production

if [ -n "${MEETCON_CERT_FULL:-}" ] && [ -f "$MEETCON_CERT_FULL" ] \
  && [ -n "${MEETCON_CERT_KEY:-}" ] && [ -f "$MEETCON_CERT_KEY" ]; then
  mkdir -p deploy/certs
  install -m 600 -D "$MEETCON_CERT_FULL" deploy/certs/fullchain.pem
  install -m 600 -D "$MEETCON_CERT_KEY" deploy/certs/privkey.pem
  echo "TLS installed from Jenkins credentials."
else
  echo "TLS Jenkins credentials not set — using self-signed certs in deploy/certs (lab / interim)."
  bash deploy/certs/generate-self-signed.sh "${MEETCON_TLS_CN:-meetcon.local}"
fi

echo "Production secrets installed from Jenkins."
