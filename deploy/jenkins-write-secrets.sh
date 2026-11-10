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

file_value() {
  grep -E "^${2}=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true
}

env_value() {
  file_value .env.production "$1"
}

example_password() {
  case "$1" in
    ""|meetcon|change-me|change-me-use-openssl-rand-base64-24) return 0 ;;
    *) return 1 ;;
  esac
}

# Keep WEB_ORIGIN and the rest of the Jenkins file. Replace only the sample database password.
replace_example_password() {
  local new user db line tmp
  new="$(random_password)"
  user="$(env_value POSTGRES_USER)"
  db="$(env_value POSTGRES_DB)"
  user="${user:-meetcon}"
  db="${db:-meetcon}"
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$new" ;;
      DATABASE_URL=*) printf 'DATABASE_URL=postgresql://%s:%s@postgres:5432/%s\n' "$user" "$new" "$db" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.production > "$tmp"
  mv "$tmp" .env.production
  chmod 600 .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  echo "Jenkins file still had the example database password. A password was generated and saved at ${SECRETS_DIR}/.env.production. It is not printed here."
}

origin_host() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#/.*##; s#:[0-9]+$##'
}

install_env_from() {
  install -m 600 "$1" .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
}

# Public site is https://meetcon.aiadoptionecosystem.com (port 443).
# Docker publishes container 30098 on the VM's port 30098.
ensure_public_origin() {
  local origin fixed current_origin current_port line tmp
  origin="$(env_value WEB_ORIGIN)"
  origin="${origin%/}"
  origin="$(printf '%s' "$origin" | sed -E 's#:30098$##')"
  if [ -z "$origin" ]; then
    origin="https://meetcon.aiadoptionecosystem.com"
  fi
  fixed="$origin"
  current_origin="$(env_value WEB_ORIGIN)"
  current_port="$(env_value GATEWAY_PUBLIC_PORT)"
  [ "$current_origin" = "$fixed" ] && [ "$current_port" = "30098" ] && return 0
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      WEB_ORIGIN=*) printf 'WEB_ORIGIN=%s\n' "$fixed" ;;
      GATEWAY_PUBLIC_PORT=*) printf 'GATEWAY_PUBLIC_PORT=30098\n' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.production > "$tmp"
  if ! grep -q '^GATEWAY_PUBLIC_PORT=' "$tmp"; then
    printf 'GATEWAY_PUBLIC_PORT=30098\n' >> "$tmp"
  fi
  mv "$tmp" .env.production
  chmod 600 .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  echo "Public URL is ${fixed}. Docker port 30098 is mapped to VM port 30098."
}

# Postgres is created with POSTGRES_PASSWORD. The API logs in with DATABASE_URL.
sync_database_url() {
  local user pass db expected current line tmp
  user="$(env_value POSTGRES_USER)"
  pass="$(env_value POSTGRES_PASSWORD)"
  db="$(env_value POSTGRES_DB)"
  user="${user:-meetcon}"
  db="${db:-meetcon}"
  [ -n "$pass" ] || return 0
  expected="postgresql://${user}:${pass}@postgres:5432/${db}"
  current="$(env_value DATABASE_URL)"
  [ "$current" = "$expected" ] && return 0
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      DATABASE_URL=*) printf 'DATABASE_URL=%s\n' "$expected" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.production > "$tmp"
  mv "$tmp" .env.production
  chmod 600 .env.production
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  echo "DATABASE_URL now uses the same database user and password as POSTGRES_PASSWORD."
}

set_env_line() {
  local key="$1" value="$2" line tmp found
  tmp="$(mktemp)"
  found=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      "${key}="*) printf '%s=%s\n' "$key" "$value"; found=1 ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.production > "$tmp"
  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" .env.production
  chmod 600 .env.production
}

# Production does not use the local .env file. Copy LinkedIn when that file is still blank.
trim_env() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

fill_linkedin() {
  local id secret origin redirect
  id="$(trim_env "$(env_value LINKEDIN_CLIENT_ID)")"
  secret="$(trim_env "$(env_value LINKEDIN_CLIENT_SECRET)")"
  if [ -z "$id" ] && [ -f .env ]; then
    id="$(trim_env "$(file_value .env LINKEDIN_CLIENT_ID)")"
  fi
  if [ -z "$secret" ] && [ -f .env ]; then
    secret="$(trim_env "$(file_value .env LINKEDIN_CLIENT_SECRET)")"
  fi
  if [ -z "$id" ] && [ -f deploy/.linkedin-id ]; then
    id="$(trim_env "$(tr -d '\r' < deploy/.linkedin-id)")"
  fi
  if [ -z "$secret" ] && [ -f deploy/.linkedin-secret ]; then
    secret="$(trim_env "$(tr -d '\r' < deploy/.linkedin-secret)")"
  fi
  if [ -z "$id" ]; then id="$(trim_env "${MEETCON_LINKEDIN_CLIENT_ID:-}")"; fi
  if [ -z "$secret" ]; then secret="$(trim_env "${MEETCON_LINKEDIN_CLIENT_SECRET:-}")"; fi
  if [ -z "$id" ]; then id="$(trim_env "${jenkins_linkedin_id:-}")"; fi
  if [ -z "$secret" ]; then secret="$(trim_env "${jenkins_linkedin_secret:-}")"; fi
  if [ -n "$id" ] && [ -f "$id" ]; then
    id="$(trim_env "$(tr -d '\r' < "$id")")"
  fi
  if [ -n "$secret" ] && [ -f "$secret" ]; then
    secret="$(trim_env "$(tr -d '\r' < "$secret")")"
  fi
  if [ -z "$id" ] && [ -n "${MEETCON_LINKEDIN_ID_FILE:-}" ] && [ -f "${MEETCON_LINKEDIN_ID_FILE}" ]; then
    id="$(trim_env "$(tr -d '\r' < "${MEETCON_LINKEDIN_ID_FILE}")")"
  fi
  if [ -z "$secret" ] && [ -n "${MEETCON_LINKEDIN_SECRET_FILE:-}" ] && [ -f "${MEETCON_LINKEDIN_SECRET_FILE}" ]; then
    secret="$(trim_env "$(tr -d '\r' < "${MEETCON_LINKEDIN_SECRET_FILE}")")"
  fi
  rm -f deploy/.linkedin-id deploy/.linkedin-secret
  echo "Jenkins LinkedIn client id length: ${#id}"
  echo "Jenkins LinkedIn client secret length: ${#secret}"
  origin="$(env_value WEB_ORIGIN)"
  origin="${origin%/}"
  redirect="${origin}/api/auth/linkedin/callback"
  if [ -z "$id" ] || [ -z "$secret" ]; then
    echo "WARN: LinkedIn client id length is ${#id} and client secret length is ${#secret}." >&2
    echo "Open each Jenkins credential and paste the secret value. The id alone is not enough. Use Secret text, and paste only the value from .env." >&2
    if [ "${CI:-}" = "true" ]; then
      exit 1
    fi
    return 0
  fi
  set_env_line LINKEDIN_CLIENT_ID "$id"
  set_env_line LINKEDIN_CLIENT_SECRET "$secret"
  set_env_line LINKEDIN_REDIRECT_URI "$redirect"
  install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  echo "LinkedIn sign-in is configured. Register this redirect URL on the LinkedIn app: ${redirect}"
}

generate_env() {
  local pass host port origin
  pass="$(random_password)"
  port="30098"
  if [ -n "${MEETCON_PUBLIC_HOST:-}" ]; then
    host="${MEETCON_PUBLIC_HOST}"
  else
    host="$(origin_host "$(grep -E '^WEB_ORIGIN=' .env.production.example | tail -1 | cut -d= -f2- | tr -d '\r')")"
  fi
  origin="https://${host}"
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

jenkins_linkedin_id=""
jenkins_linkedin_secret=""
if [ -n "${MEETCON_ENV_FILE:-}" ] && [ -f "$MEETCON_ENV_FILE" ]; then
  jenkins_linkedin_id="$(trim_env "$(file_value "$MEETCON_ENV_FILE" LINKEDIN_CLIENT_ID)")"
  jenkins_linkedin_secret="$(trim_env "$(file_value "$MEETCON_ENV_FILE" LINKEDIN_CLIENT_SECRET)")"
  echo "Using Jenkins credential file for .env.production."
  install -m 600 "$MEETCON_ENV_FILE" .env.production
  if example_password "$(env_value POSTGRES_PASSWORD)"; then
    saved_pass=""
    if [ -f "${SECRETS_DIR}/.env.production" ]; then
      saved_pass="$(file_value "${SECRETS_DIR}/.env.production" POSTGRES_PASSWORD)"
    fi
    if ! example_password "$saved_pass"; then
      echo "Keeping the database password already saved on this VM."
      install_env_from "${SECRETS_DIR}/.env.production"
    else
      replace_example_password
    fi
  else
    install -m 600 .env.production "${SECRETS_DIR}/.env.production"
  fi
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

ensure_public_origin
fill_linkedin
sync_database_url

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
