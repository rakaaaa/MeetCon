#!/usr/bin/env bash
# Validates .env.production before deploy (called from jenkins-write-secrets.sh).
set -eu
FILE="${1:-.env.production}"
if [ ! -f "$FILE" ]; then
  echo "Missing $FILE" >&2
  exit 1
fi

get_var() {
  grep -E "^${1}=" "$FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true
}

token="$(get_var TOKEN_ENCRYPTION_KEY)"
if [ -z "$token" ]; then
  echo "TOKEN_ENCRYPTION_KEY is required in $FILE" >&2
  exit 1
fi
if ! printf '%s' "$token" | grep -qE '^[A-Za-z0-9_-]{43}$'; then
  echo "TOKEN_ENCRYPTION_KEY must be exactly 43 base64url characters (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\")" >&2
  exit 1
fi

db_url="$(get_var DATABASE_URL)"
pg_pass="$(get_var POSTGRES_PASSWORD)"
if [ -z "$db_url" ]; then
  echo "DATABASE_URL is required in $FILE" >&2
  exit 1
fi
if [ -n "$pg_pass" ] && ! printf '%s' "$db_url" | grep -qF "$pg_pass"; then
  echo "WARN: DATABASE_URL does not contain POSTGRES_PASSWORD — Postgres auth may fail on migrate." >&2
  echo "      Use the same password in both, or URL-encode special characters in DATABASE_URL." >&2
fi

port="$(get_var GATEWAY_PUBLIC_PORT)"
port="${port:-30098}"
origin="$(get_var WEB_ORIGIN)"
if [ -n "$origin" ] && ! printf '%s' "$origin" | grep -qE ":${port}(/|$)"; then
  echo "WARN: WEB_ORIGIN should include :${port} (got ${origin})" >&2
fi

echo "Production env validation OK."
