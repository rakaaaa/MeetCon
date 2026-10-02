#!/usr/bin/env sh
# MeetCon production / CI validation: env, Docker network, APIs, gateway port mapping.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="post-deploy"
STRICT=0

for arg in "$@"; do
  case "$arg" in
    --preflight-only|--preflight) MODE="preflight" ;;
    --ci-build|--ci) MODE="ci-build" ;;
    --post-deploy) MODE="post-deploy" ;;
    --strict) STRICT=1 ;;
  esac
done

COMPOSE_PROD="docker compose --env-file .env.production -f docker-compose.prod.yml"
COMPOSE_DEV="docker compose -f docker-compose.yml"
GATEWAY_CONTAINER_PORT=30098
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
warn() { echo "WARN: $*" >&2; }
ok() { echo "OK:   $*"; }
info() { echo "INFO: $*"; }

read_env_var() {
  key="$1"
  default="${2:-}"
  if [ ! -f .env.production ]; then
    printf '%s' "$default"
    return
  fi
  val="$(grep -E "^${key}=" .env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -z "$val" ]; then printf '%s' "$default"; else printf '%s' "$val"; fi
}

require_env_keys() {
  for key in POSTGRES_PASSWORD DATABASE_URL REDIS_URL WEB_ORIGIN TOKEN_ENCRYPTION_KEY; do
    val="$(read_env_var "$key" "")"
    if [ -z "$val" ]; then
      fail ".env.production: missing ${key}"
    elif printf '%s' "$val" | grep -qi 'change-me\|REPLACE_WITH'; then
      fail ".env.production: replace placeholder for ${key}"
    elif [ "$key" = "WEB_ORIGIN" ] && [ "$val" = "https://meetcon.example.com:30098" ]; then
      fail ".env.production: set WEB_ORIGIN to your real public URL"
    else
      ok ".env.production ${key} is set"
    fi
  done
}

finish() {
  if [ "$FAIL" -eq 1 ]; then
    echo "=== Validation failed ===" >&2
    [ "$STRICT" -eq 1 ] && exit 1
    exit 0
  fi
  echo "=== Validation passed ==="
  exit 0
}

run_ci_build() {
  echo "=== CI: Docker Compose config ==="
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not available on build agent (skip VALIDATE_DOCKER_COMPOSE or install Docker)"
    finish
  fi
  docker compose version >/dev/null || fail "docker compose v2 missing"
  ok "docker compose available"

  if [ ! -f .env.production.example ]; then
    fail ".env.production.example missing"
  else
    docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet \
      && ok "docker-compose.prod.yml renders"
  fi

  if [ -f docker-compose.yml ]; then
    docker compose -f docker-compose.yml config --quiet && ok "docker-compose.yml renders"
  fi

  finish
}

run_preflight() {
  echo "=== Preflight: VM deploy readiness ==="
  test -f .env.production && ok ".env.production present" || fail ".env.production missing"
  test -f deploy/certs/fullchain.pem && ok "TLS fullchain.pem present" || fail "missing deploy/certs/fullchain.pem"
  test -f deploy/certs/privkey.pem && ok "TLS privkey.pem present" || fail "missing deploy/certs/privkey.pem"

  command -v docker >/dev/null && ok "docker installed" || fail "docker missing"
  docker compose version >/dev/null && ok "docker compose v2" || fail "docker compose v2 missing"
  docker info >/dev/null 2>&1 && ok "docker daemon reachable" || fail "docker daemon not reachable"

  if [ -f .env.production ]; then
    require_env_keys
    $COMPOSE_PROD config --quiet && ok "production compose file valid for current .env.production"
    port="$(read_env_var GATEWAY_PUBLIC_PORT 30098)"
    origin="$(read_env_var WEB_ORIGIN '')"
    info "GATEWAY_PUBLIC_PORT=${port}"
    info "WEB_ORIGIN=${origin}"
    if [ -n "$origin" ] && ! echo "$origin" | grep -q ":${port}"; then
      fail "WEB_ORIGIN must include :${port} (cookies, CORS, QR links)"
    fi
  fi

  finish
}

service_health() {
  svc="$1"
  cid="$($COMPOSE_PROD ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    fail "service ${svc} is not running"
    return
  fi
  ok "service ${svc} container running (${cid:0:12})"
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$cid" 2>/dev/null || echo unknown)"
  case "$status" in
    healthy) ok "service ${svc} health=healthy" ;;
    starting)
      if [ "$svc" = "gateway" ] || [ "$svc" = "api" ]; then
        warn "service ${svc} health=starting (may need more time)"
      else
        ok "service ${svc} health=starting"
      fi
      ;;
    unhealthy) fail "service ${svc} health=unhealthy" ;;
    no-healthcheck) info "service ${svc} has no Docker healthcheck" ;;
    *) warn "service ${svc} health=${status}" ;;
  esac
}

run_post_deploy() {
  echo "=== Post-deploy: stack, network, APIs ==="
  test -f .env.production || fail ".env.production missing"

  GATEWAY_PUBLIC_PORT="$(read_env_var GATEWAY_PUBLIC_PORT 30098)"
  WEB_ORIGIN="$(read_env_var WEB_ORIGIN '')"
  HEALTH_URL="${HEALTH_CHECK_URL:-}"

  info "Checking compose services..."
  $COMPOSE_PROD ps

  for svc in postgres redis api gateway; do
    service_health "$svc"
  done

  echo ""
  info "Internal Docker network (data stores)..."
  if $COMPOSE_PROD exec -T postgres pg_isready -U "$(read_env_var POSTGRES_USER meetcon)" -d "$(read_env_var POSTGRES_DB meetcon)" >/dev/null 2>&1; then
    ok "postgres accepts connections (pg_isready)"
  else
    fail "postgres pg_isready failed"
  fi

  if [ "$($COMPOSE_PROD exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]; then
    ok "redis responds PONG"
  else
    fail "redis ping failed"
  fi

  echo ""
  info "API health (direct inside api container)..."
  if $COMPOSE_PROD exec -T api node -e 'fetch("http://127.0.0.1:3001/health").then((r)=>r.json().then((j)=>{if(!r.ok||j.status!=="ok")process.exit(1);console.log(JSON.stringify(j));})).catch(()=>process.exit(1))' >/tmp/meetcon-api-health.json 2>/dev/null; then
    ok "API /health (internal) status=200 database+redis"
    info "$(cat /tmp/meetcon-api-health.json 2>/dev/null || true)"
  else
    fail "API internal /health failed"
  fi

  echo ""
  info "Gateway HTTPS on host :${GATEWAY_PUBLIC_PORT}..."
  gw_health="https://127.0.0.1:${GATEWAY_PUBLIC_PORT}/health"
  if command -v curl >/dev/null 2>&1; then
    if curl -kfsS --max-time 15 "$gw_health" | grep -q '"status":"ok"'; then
      ok "gateway proxied GET /health"
    else
      fail "gateway GET /health did not return ok JSON"
    fi

    session_code="$(curl -kfsS -o /tmp/meetcon-session.json -w '%{http_code}' --max-time 15 \
      "https://127.0.0.1:${GATEWAY_PUBLIC_PORT}/api/auth/session" || echo 000)"
    if [ "$session_code" = "200" ] && grep -q '"user"' /tmp/meetcon-session.json 2>/dev/null; then
      ok "gateway proxied GET /api/auth/session (HTTP 200)"
    else
      fail "gateway /api/auth/session expected 200 with user field (got ${session_code})"
    fi

    if curl -kfsS --max-time 15 "https://127.0.0.1:${GATEWAY_PUBLIC_PORT}/" | grep -qiE '<html|id="root"|<!DOCTYPE'; then
      ok "gateway serves SPA index.html"
    else
      fail "gateway did not return SPA HTML at /"
    fi
  else
    warn "curl missing; skip gateway HTTP checks"
  fi

  echo ""
  info "Host must not publish API :3001..."
  if command -v ss >/dev/null 2>&1 && ss -tlnH 'sport = :3001' 2>/dev/null | grep -q .; then
    warn "TCP 3001 is listening on the host (API should stay internal)"
  else
    ok "host TCP 3001 not exposed"
  fi

  if [ -x ./deploy/diagnose-gateway-port.sh ]; then
    echo ""
    ./deploy/diagnose-gateway-port.sh || fail "gateway port diagnostics reported issues"
  fi

  if [ -n "$HEALTH_URL" ]; then
    echo ""
    info "External HEALTH_CHECK_URL=${HEALTH_URL} (optional; loopback check is required for deploy)"
    if curl -fsS --max-time 20 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"' \
      || curl -kfsS --max-time 20 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
      ok "external health URL reachable"
    else
      warn "external URL not reachable from VM (DNS/firewall/TLS) — app may still work via :${GATEWAY_PUBLIC_PORT}"
    fi
  elif [ -n "$WEB_ORIGIN" ]; then
    ext="${WEB_ORIGIN%/}/health"
    info "Probing WEB_ORIGIN health: ${ext}"
    if curl -fsS --max-time 20 "$ext" 2>/dev/null | grep -q '"status":"ok"' \
      || curl -kfsS --max-time 20 "$ext" 2>/dev/null | grep -q '"status":"ok"'; then
      ok "WEB_ORIGIN /health reachable"
    else
      warn "could not reach ${ext} from this host (DNS/firewall/TLS); set HEALTH_CHECK_URL in Jenkins"
    fi
  fi

  finish
}

case "$MODE" in
  ci-build) run_ci_build ;;
  preflight) run_preflight ;;
  post-deploy) run_post_deploy ;;
  *)
    echo "Usage: $0 [--ci-build|--preflight-only|--post-deploy] [--strict]" >&2
    exit 2
    ;;
esac
