#!/usr/bin/env bash
# Copy production secrets into the workspace from outside git (Docker-only VM layout).
# Set Jenkins job env: MEETCON_SECRETS_DIR=/etc/meetcon
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DIR="${MEETCON_SECRETS_DIR:-}"
if [ -z "$DIR" ]; then
  echo "MEETCON_SECRETS_DIR not set — using workspace .env.production + deploy/certs/ if present."
  exit 0
fi

if [ ! -d "$DIR" ]; then
  echo "MEETCON_SECRETS_DIR=$DIR does not exist" >&2
  exit 1
fi

[ -f "$DIR/.env.production" ] || { echo "Missing $DIR/.env.production" >&2; exit 1; }
cp -a "$DIR/.env.production" "${ROOT}/.env.production"
mkdir -p "${ROOT}/deploy/certs"
[ -f "$DIR/fullchain.pem" ] && cp -a "$DIR/fullchain.pem" "${ROOT}/deploy/certs/fullchain.pem"
[ -f "$DIR/privkey.pem" ] && cp -a "$DIR/privkey.pem" "${ROOT}/deploy/certs/privkey.pem"
[ -f "$DIR/deploy/certs/fullchain.pem" ] && cp -a "$DIR/deploy/certs/." "${ROOT}/deploy/certs/"
echo "Loaded secrets from ${DIR}"
