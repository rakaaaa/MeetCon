#!/usr/bin/env bash
# Minimal checks before deploy (encryption key is derived from POSTGRES_PASSWORD in the API).
set -eu
FILE="${1:-.env.production}"
[ -f "$FILE" ] || { echo "Missing $FILE" >&2; exit 1; }

sed -i '1s/^\xEF\xBB\xBF//' "$FILE" 2>/dev/null || true

get_var() {
  grep -E "^${1}=" "$FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true
}

for key in POSTGRES_PASSWORD DATABASE_URL REDIS_URL WEB_ORIGIN; do
  val="$(get_var "$key")"
  if [ -z "$val" ]; then
    echo "Missing ${key} in $FILE" >&2
    exit 1
  fi
done

port="$(get_var GATEWAY_PUBLIC_PORT)"
port="${port:-30098}"
origin="$(get_var WEB_ORIGIN)"
if ! printf '%s' "$origin" | grep -qE ":${port}(/|$)"; then
  echo "WARN: WEB_ORIGIN should include :${port} (got ${origin})" >&2
fi

pg_pass="$(get_var POSTGRES_PASSWORD)"
if ! printf '%s' "$(get_var DATABASE_URL)" | grep -qF "$pg_pass"; then
  echo "WARN: DATABASE_URL password may not match POSTGRES_PASSWORD" >&2
fi

echo "Production env OK."
