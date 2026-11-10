#!/usr/bin/env bash
# Prepare a fresh or repeat Jenkins install.
# 1. Jenkins secret file meetcon-production-env, if the job provides it
# 2. Otherwise the copy saved on the VM from the first successful build
# 3. Otherwise generate .env.production and a TLS certificate once
# Later builds reuse the saved files so the database password stays the same.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SECRETS_DIR="${MEETCON_SECRETS_DIR:-${JENKINS_HOME:-$HOME}/meetcon}"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
}

env_value() {
  grep -E "^${1}=" .env.production | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

origin_host() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#/.*##; s#:[0-9]+$##'
}

install_env_from() {
  install -m 600 "$1" .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
}

generate_env() {
  local pass host port origin
  pass="$(random_password)"
  port="${MEETCON_PUBLIC_PORT:-30098}"
  if [ -n "${MEETCON_PUBLIC_HOST:-}" ]; then
    host="${MEETCON_PUBLIC_HOST}"
  else
    host="$(origin_host "$(grep -E '^WEB_ORIGIN=' .env.production.example | tail -1 | cut -d= -f2- | tr -d '\r')")"
  fi
  origin="https://${host}:${port}"
  umask 077
  sed -e "s/change-me-use-openssl-rand-base64-24/${pass}/g" \
      -e "s/^SMTP_PASSWORD=change-me$/SMTP_PASSWORD=/" \
      -e "s|^WEB_ORIGIN=.*|WEB_ORIGIN=${origin}|" \
      -e "s/^GATEWAY_PUBLIC_PORT=.*/GATEWAY_PUBLIC_PORT=${port}/" \
      .env.production.example > .env.production
  chmod 600 .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  echo "Created a new production env at ${SECRETS_DIR}/.env.production"
  echo "WEB_ORIGIN=${origin}"
  echo "Set SMTP in that file when password-reset mail is needed. The database password is already in the file and is not printed here."
}

generate_cert() {
  local cn="$1"
  mkdir -p deploy/certs
  if command -v openssl >/dev/null 2>&1; then
    sh deploy/certs/generate-self-signed.sh "$cn"
  else
    echo "openssl is not on the host — generating the certificate with Docker."
    docker run --rm -v "${ROOT}/deploy/certs:/work" -w /work alpine:3.20 \
      sh -c "apk add --no-cache openssl >/dev/null && sh generate-self-signed.sh '${cn}' && chmod 644 fullchain.pem privkey.pem && chown $(id -u):$(id -g) fullchain.pem privkey.pem"
  fi
  install -m 644 deploy/certs/fullchain.pem "${SECRETS_DIR}/fullchain.pem"
  install -m 600 deploy/certs/privkey.pem "${SECRETS_DIR}/privkey.pem"
}

if [ -n "${MEETCON_ENV_FILE:-}" ] && [ -f "$MEETCON_ENV_FILE" ]; then
  echo "Using Jenkins credential file for .env.production."
  install_env_from "$MEETCON_ENV_FILE"
elif [ -f "${SECRETS_DIR}/.env.production" ]; then
  echo "Reusing saved production env from ${SECRETS_DIR}."
  install_env_from "${SECRETS_DIR}/.env.production"
elif [ -f .env.production ]; then
  echo "Using workspace .env.production and saving it for the next build."
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
else
  echo "No Jenkins secret file yet. Creating the first production env on this VM."
  generate_env
fi

bash deploy/validate-production-env.sh .env.production

mkdir -p deploy/certs
if [ -n "${MEETCON_CERT_FULL:-}" ] && [ -f "$MEETCON_CERT_FULL" ] \
  && [ -n "${MEETCON_CERT_KEY:-}" ] && [ -f "$MEETCON_CERT_KEY" ]; then
  install -m 644 "$MEETCON_CERT_FULL" deploy/certs/fullchain.pem
  install -m 600 "$MEETCON_CERT_KEY" deploy/certs/privkey.pem
  install -m 644 deploy/certs/fullchain.pem "${SECRETS_DIR}/fullchain.pem"
  install -m 600 deploy/certs/privkey.pem "${SECRETS_DIR}/privkey.pem"
  echo "TLS installed from Jenkins credentials."
elif [ -f "${SECRETS_DIR}/fullchain.pem" ] && [ -f "${SECRETS_DIR}/privkey.pem" ]; then
  install -m 644 "${SECRETS_DIR}/fullchain.pem" deploy/certs/fullchain.pem
  install -m 600 "${SECRETS_DIR}/privkey.pem" deploy/certs/privkey.pem
  echo "Reusing saved TLS certificate."
else
  cn="$(origin_host "$(env_value WEB_ORIGIN)")"
  echo "No TLS certificate yet — creating a self-signed certificate for ${cn}."
  generate_cert "$cn"
fi

echo "Production files are ready. WEB_ORIGIN=$(env_value WEB_ORIGIN)"
