#!/usr/bin/env sh
# Diagnostics for VM host port → gateway container HTTPS (default 30098).
# Run on the production VM from repo root after deploy (or when debugging exposure).
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
GATEWAY_CONTAINER_PORT=30098
FAIL=0

warn() {
  echo "WARN: $*" >&2
}

fail() {
  echo "FAIL: $*" >&2
  FAIL=1
}

info() {
  echo "INFO: $*"
}

ok() {
  echo "OK:   $*"
}

read_env_var() {
  key="$1"
  default="${2:-}"
  if [ ! -f .env.production ]; then
    printf '%s' "$default"
    return
  fi
  val="$(grep -E "^${key}=" .env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -z "$val" ]; then
    printf '%s' "$default"
  else
    printf '%s' "$val"
  fi
}

GATEWAY_PUBLIC_PORT="$(read_env_var GATEWAY_PUBLIC_PORT 30098)"
WEB_ORIGIN="$(read_env_var WEB_ORIGIN '')"

echo "=== MeetCon gateway port diagnostics ==="
info "Expected VM bind: 0.0.0.0:${GATEWAY_PUBLIC_PORT} → gateway container :${GATEWAY_CONTAINER_PORT} (HTTPS)"
info "API should stay internal (docker network :3001, not published on host)"

if [ ! -f .env.production ]; then
  fail ".env.production missing"
else
  ok ".env.production present"
fi

if [ -z "$WEB_ORIGIN" ]; then
  warn "WEB_ORIGIN is not set in .env.production"
else
  info "WEB_ORIGIN=${WEB_ORIGIN}"
  origin_port="$(printf '%s' "$WEB_ORIGIN" | sed -n 's/.*:\([0-9][0-9]*\)\/?$/\1/p')"
  if [ -z "$origin_port" ]; then
    warn "WEB_ORIGIN has no explicit port; production should include :${GATEWAY_PUBLIC_PORT}"
  elif [ "$origin_port" != "$GATEWAY_PUBLIC_PORT" ]; then
    fail "WEB_ORIGIN port (${origin_port}) does not match GATEWAY_PUBLIC_PORT (${GATEWAY_PUBLIC_PORT})"
  else
    ok "WEB_ORIGIN port matches GATEWAY_PUBLIC_PORT"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  fail "docker not found on PATH"
elif ! docker compose version >/dev/null 2>&1; then
  fail "docker compose v2 plugin not available"
else
  ok "docker compose available"
fi

if [ -f .env.production ]; then
  echo ""
  info "Compose services:"
  $COMPOSE ps 2>/dev/null || warn "could not run compose ps (stack may be down)"

  gateway_id="$($COMPOSE ps -q gateway 2>/dev/null || true)"
  if [ -z "$gateway_id" ]; then
    warn "gateway container is not running"
  else
    ok "gateway container id=${gateway_id}"
    echo ""
    info "Published ports (gateway):"
    docker port "$gateway_id" 2>/dev/null || warn "docker port failed for gateway"
    mapping="$(docker port "$gateway_id" "${GATEWAY_CONTAINER_PORT}/tcp" 2>/dev/null | head -1 || true)"
    if [ -z "$mapping" ]; then
      mapping="$(docker port "$gateway_id" "${GATEWAY_CONTAINER_PORT}" 2>/dev/null | head -1 || true)"
    fi
    if [ -z "$mapping" ]; then
      fail "no host mapping for container TCP ${GATEWAY_CONTAINER_PORT}"
    else
      info "docker port mapping: ${mapping}"
      host_port="$(printf '%s' "$mapping" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
      if [ "$host_port" = "$GATEWAY_PUBLIC_PORT" ]; then
        ok "container :${GATEWAY_CONTAINER_PORT} mapped to host port ${GATEWAY_PUBLIC_PORT}"
      else
        warn "expected host port ${GATEWAY_PUBLIC_PORT}, got mapping: ${mapping}"
      fi
    fi
  fi
fi

echo ""
info "Host listener check (0.0.0.0:${GATEWAY_PUBLIC_PORT}):"
if command -v ss >/dev/null 2>&1; then
  if ss -tlnH "sport = :${GATEWAY_PUBLIC_PORT}" 2>/dev/null | grep -q .; then
    ss -tlnp "sport = :${GATEWAY_PUBLIC_PORT}" 2>/dev/null || ss -tln "sport = :${GATEWAY_PUBLIC_PORT}" 2>/dev/null || true
    ok "something is listening on TCP ${GATEWAY_PUBLIC_PORT}"
  else
    warn "no listener on TCP ${GATEWAY_PUBLIC_PORT} (stack down or wrong port)"
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -tln 2>/dev/null | grep -q ":${GATEWAY_PUBLIC_PORT} "; then
    netstat -tln 2>/dev/null | grep ":${GATEWAY_PUBLIC_PORT} " || true
    ok "something is listening on TCP ${GATEWAY_PUBLIC_PORT}"
  else
    warn "no listener on TCP ${GATEWAY_PUBLIC_PORT}"
  fi
else
  warn "ss/netstat not available; skip host listener check"
fi

echo ""
info "Accidental API exposure on host :3001 (should be empty):"
if command -v ss >/dev/null 2>&1; then
  if ss -tlnH "sport = :3001" 2>/dev/null | grep -q .; then
    warn "TCP 3001 is listening on the host — API should not be published in production"
    ss -tln "sport = :3001" 2>/dev/null || true
  else
    ok "host TCP 3001 not listening (expected)"
  fi
fi

if command -v ufw >/dev/null 2>&1; then
  echo ""
  info "ufw rules mentioning ${GATEWAY_PUBLIC_PORT}:"
  if sudo -n ufw status 2>/dev/null | grep -q "${GATEWAY_PUBLIC_PORT}/tcp"; then
    sudo -n ufw status 2>/dev/null | grep "${GATEWAY_PUBLIC_PORT}/tcp" || true
    ok "ufw allows ${GATEWAY_PUBLIC_PORT}/tcp"
  elif ufw status 2>/dev/null | grep -q "${GATEWAY_PUBLIC_PORT}/tcp"; then
    ufw status 2>/dev/null | grep "${GATEWAY_PUBLIC_PORT}/tcp" || true
    ok "ufw allows ${GATEWAY_PUBLIC_PORT}/tcp"
  else
    warn "ufw has no rule for ${GATEWAY_PUBLIC_PORT}/tcp (or cannot read ufw); check cloud security group"
  fi
fi

echo ""
info "HTTPS probe via loopback (gateway TLS):"
health_url="https://127.0.0.1:${GATEWAY_PUBLIC_PORT}/health"
if command -v curl >/dev/null 2>&1; then
  if curl -kfsS --max-time 10 "$health_url" >/dev/null 2>&1; then
    ok "curl ${health_url}"
    curl -kfsS --max-time 10 "$health_url" 2>/dev/null | head -c 200 || true
    echo ""
  else
    fail "curl failed for ${health_url} (gateway down, certs, or port mismatch)"
    curl -kv --max-time 10 "$health_url" 2>&1 | tail -20 || true
  fi
else
  warn "curl not installed; skip HTTPS probe"
fi

echo ""
if [ "$FAIL" -eq 1 ]; then
  echo "=== Diagnostics finished with failures ===" >&2
  if [ "$STRICT" -eq 1 ]; then
    exit 1
  fi
  exit 0
fi

echo "=== Diagnostics finished OK ==="
exit 0
