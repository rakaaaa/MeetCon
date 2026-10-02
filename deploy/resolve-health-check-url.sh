#!/usr/bin/env sh
# Print HEALTH_CHECK_URL for deploy/CI: param/env override, else WEB_ORIGIN/health from .env.production.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "${HEALTH_CHECK_URL:-}" ]; then
  printf '%s' "${HEALTH_CHECK_URL%/}"
  exit 0
fi

if [ -n "${MEETCON_HEALTH_CHECK_URL:-}" ]; then
  printf '%s' "${MEETCON_HEALTH_CHECK_URL%/}"
  exit 0
fi

if [ -f .env.production ]; then
  origin="$(grep -E '^WEB_ORIGIN=' .env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -n "$origin" ]; then
    origin="${origin%/}"
    printf '%s/health' "$origin"
    exit 0
  fi
fi

exit 0
