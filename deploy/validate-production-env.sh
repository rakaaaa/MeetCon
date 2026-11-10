#!/usr/bin/env bash
# Reject a production or simulation env file that still looks like local development.
# Local development uses `.env`. Prefer the Node checker when Node is installed.
set -eu
if command -v node >/dev/null 2>&1; then
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec node "${SCRIPT_DIR}/validate-production-env.mjs" "$@"
fi

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

runtime="$(get_var NODE_ENV)"
if [ "$runtime" != "production" ]; then
  echo "NODE_ENV must be production in $FILE. Local development uses .env." >&2
  exit 1
fi

pg_pass="$(get_var POSTGRES_PASSWORD)"
case "$pg_pass" in
  meetcon|change-me|change-me-use-openssl-rand-base64-24)
    echo "POSTGRES_PASSWORD in $FILE is still a development or example value." >&2
    exit 1
    ;;
esac

db_url="$(get_var DATABASE_URL)"
case "$db_url" in
  *@localhost:*|*"@localhost/"*|*"@127.0.0.1:"*|*"@127.0.0.1/"*)
    echo "DATABASE_URL in $FILE must use the Docker hostname postgres, not localhost." >&2
    exit 1
    ;;
esac

redis_url="$(get_var REDIS_URL)"
case "$redis_url" in
  redis://localhost:*|redis://localhost|redis://127.0.0.1:*|redis://127.0.0.1)
    echo "REDIS_URL in $FILE must use the Docker hostname redis, not localhost." >&2
    exit 1
    ;;
esac

port="$(get_var GATEWAY_PUBLIC_PORT)"
case "$(basename "$FILE")" in
  .env.simulation) port="${port:-30998}" ;;
  *) port="${port:-30098}" ;;
esac
origin="$(get_var WEB_ORIGIN)"
case "$origin" in
  https://*) ;;
  *)
    echo "WEB_ORIGIN in $FILE must start with https://" >&2
    exit 1
    ;;
esac
case "$(basename "$FILE")" in
  .env.production)
    case "$origin" in
      *localhost*|*127.0.0.1*)
        echo "WEB_ORIGIN in .env.production must be the public host. Simulation uses .env.simulation." >&2
        exit 1
        ;;
    esac
    ;;
esac
if ! printf '%s' "$origin" | grep -qE ":${port}(/|$)"; then
  echo "WARN: WEB_ORIGIN should include :${port} (got ${origin})" >&2
fi

pg_pass="$(get_var POSTGRES_PASSWORD)"
if ! printf '%s' "$(get_var DATABASE_URL)" | grep -qF "$pg_pass"; then
  echo "WARN: DATABASE_URL password may not match POSTGRES_PASSWORD" >&2
fi

if [ "$(get_var SMTP_PASSWORD)" = "change-me" ]; then
  echo "WARN: SMTP_PASSWORD is still the example value. Password reset mail will fail until it is set." >&2
fi

echo "Production env OK."
