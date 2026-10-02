#!/usr/bin/env bash
# MeetCon ops CLI — one entry point for VM / Jenkins maintenance.
# Usage: ./deploy/meetcon.sh <command>
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROD=(docker compose --env-file .env.production -f docker-compose.prod.yml)
COMPOSE_SIM=(docker compose --env-file .env.simulation -f docker-compose.prod.yml -f docker-compose.sim.override.yml)
SIM_PORT=30998

read_prod_env() {
  local key="$1" default="${2:-}"
  if [ ! -f .env.production ]; then
    printf '%s' "$default"
    return
  fi
  local val
  val="$(grep -E "^${key}=" .env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [ -z "$val" ]; then printf '%s' "$default"; else printf '%s' "$val"; fi
}

gateway_port() {
  read_prod_env GATEWAY_PUBLIC_PORT 30098
}

# Health checks without installing curl on the host (uses Docker if needed).
meetcon_curl_k() {
  local url="$1"
  local max="${2:-10}"
  if command -v curl >/dev/null 2>&1; then
    curl -kfsS --max-time "$max" "$url"
  else
    docker run --rm --network host curlimages/curl:8.5.0 -kfsS --max-time "$max" "$url"
  fi
}

ensure_tls_certs() {
  if [ -f deploy/certs/fullchain.pem ] && [ -f deploy/certs/privkey.pem ]; then
    return 0
  fi
  echo "No TLS in deploy/certs — generating self-signed (not for public production)." >&2
  bash deploy/certs/generate-self-signed.sh "${MEETCON_TLS_CN:-meetcon.local}"
}

require_prod_files() {
  [ -f .env.production ] || { echo "Missing .env.production" >&2; exit 1; }
  if [ -x deploy/validate-production-env.sh ]; then
    bash deploy/validate-production-env.sh .env.production
  fi
  ensure_tls_certs
}

compose_logs() {
  "${COMPOSE_PROD[@]}" ps 2>/dev/null || true
  echo "--- migrate logs ---" >&2
  "${COMPOSE_PROD[@]}" logs --tail=80 migrate 2>/dev/null || true
  echo "--- api / gateway logs ---" >&2
  "${COMPOSE_PROD[@]}" logs --tail=60 api gateway 2>/dev/null || true
}

cmd_toolchain() {
  # Used by Jenkins / VM before pnpm build
  PNPM_VERSION="${PNPM_VERSION:-10.17.1}"
  MEETCON_PNPM_STORE_DIR="${MEETCON_PNPM_STORE_DIR:-${JENKINS_HOME:-/tmp}/.meetcon/pnpm-store}"
  command -v node >/dev/null || { echo "Install Node.js 20+ on this agent." >&2; exit 127; }
  NODE_DIR="$(dirname "$(command -v node)")"
  export PATH="${NODE_DIR}:${PATH}"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  elif [ -x "${NODE_DIR}/corepack" ]; then
    "${NODE_DIR}/corepack" enable
    "${NODE_DIR}/corepack" prepare "pnpm@${PNPM_VERSION}" --activate
  else
    npm install -g "pnpm@${PNPM_VERSION}"
  fi
  command -v pnpm >/dev/null || { echo "pnpm not available" >&2; exit 127; }
  mkdir -p "${MEETCON_PNPM_STORE_DIR}"
  pnpm config set store-dir "${MEETCON_PNPM_STORE_DIR}"
  echo "node $(node --version) | pnpm $(pnpm --version)"
}

cmd_backup() {
  require_prod_files
  STAMP="$(date +%Y%m%d-%H%M%S)"
  OUT="backups/postgres-${STAMP}.sql.gz"
  mkdir -p backups
  set -a
  # shellcheck disable=SC1091
  . ./.env.production
  set +a
  "${COMPOSE_PROD[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$OUT"
  echo "Wrote $OUT"
}

cmd_up() {
  require_prod_files
  "${COMPOSE_PROD[@]}" up -d --build "$@"
  local port
  port="$(gateway_port)"
  echo ""
  echo "Stack up on 0.0.0.0:${port} → gateway :30098"
  echo "WEB_ORIGIN must match (e.g. https://your-host:${port})"
  echo "Health: curl -k https://127.0.0.1:${port}/health"
}

postgres_running() {
  "${COMPOSE_PROD[@]}" ps --status running -q postgres 2>/dev/null | grep -q .
}

cmd_deploy() {
  require_prod_files
  command -v docker >/dev/null && docker compose version >/dev/null || { echo "Need Docker Compose v2" >&2; exit 1; }
  if [ "${SKIP_DB_BACKUP:-0}" != "1" ]; then
    if postgres_running; then
      cmd_backup
    else
      echo "Skipping DB backup (postgres not running yet — normal on first deploy)."
    fi
  fi
  if ! "${COMPOSE_PROD[@]}" up -d --build; then
    compose_logs
    exit 1
  fi
  local health="https://127.0.0.1:$(gateway_port)/health"
  echo "Health: $health"
  local n=0
  while [ "$n" -lt 24 ]; do
    if meetcon_curl_k "$health" 8 2>/dev/null | grep -q '"status":"ok"'; then
      echo "Deploy OK"
      "${COMPOSE_PROD[@]}" ps
      return 0
    fi
    n=$((n + 1))
    sleep 5
  done
  echo "Health check failed" >&2
  compose_logs
  exit 1
}

run_smoke_test() {
  local port origin base
  if [ -n "${SIM_BASE_URL:-}" ]; then
    base="${SIM_BASE_URL}"
    origin="${SIM_WEB_ORIGIN:-$base}"
  else
    port="$(gateway_port)"
    origin="$(read_prod_env WEB_ORIGIN '')"
    base="https://127.0.0.1:${port}"
    if [ -z "$origin" ]; then
      echo "WARN WEB_ORIGIN unset — using ${base} for smoke Origin header" >&2
      origin="$base"
    fi
  fi
  if [ ! -f "${ROOT}/scripts/pipeline-simulate.mjs" ]; then
    echo "scripts/pipeline-simulate.mjs missing — skip smoke" >&2
    return 0
  fi
  export SIM_BASE_URL="$base"
  export SIM_WEB_ORIGIN="$origin"
  if [ "${MEETCON_SMOKE_FULL:-0}" = "1" ]; then
    export SMOKE_FULL=1
  else
    unset SMOKE_FULL || true
  fi
  if command -v node >/dev/null 2>&1; then
    node "${ROOT}/scripts/pipeline-simulate.mjs"
  else
    docker run --rm --network host \
      -v "${ROOT}:/repo" -w /repo \
      -e "SIM_BASE_URL=${base}" \
      -e "SIM_WEB_ORIGIN=${origin}" \
      -e "SMOKE_FULL=${SMOKE_FULL:-}" \
      -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
      "${MEETCON_CI_IMAGE:-node:20-bookworm}" \
      node scripts/pipeline-simulate.mjs
  fi
}

cmd_smoke() {
  require_prod_files
  run_smoke_test
}

cmd_doctor() {
  local full=0
  [ "${1:-}" = "--full" ] && full=1
  if [ "$full" = 1 ] && [ -x deploy/validate-production-stack.sh ]; then
    exec deploy/validate-production-stack.sh --post-deploy --strict
  fi
  require_prod_files
  local port origin health
  port="$(gateway_port)"
  origin="$(read_prod_env WEB_ORIGIN '')"
  health="https://127.0.0.1:${port}/health"
  echo "=== MeetCon doctor ==="
  echo "GATEWAY_PUBLIC_PORT=${port} WEB_ORIGIN=${origin:-<unset>}"
  "${COMPOSE_PROD[@]}" ps || true
  if meetcon_curl_k "$health" 10 2>/dev/null | grep -q '"status":"ok"'; then
    echo "OK gateway $health"
  else
    echo "FAIL gateway $health" >&2
    exit 1
  fi
  if [ -n "$origin" ] && ! echo "$origin" | grep -qE ":${port}(/|$)"; then
    echo "WARN WEB_ORIGIN should include :${port} (e.g. https://your-host:${port})" >&2
  fi
  if [ -x deploy/diagnose-gateway-port.sh ]; then
    deploy/diagnose-gateway-port.sh || true
  fi
}

cmd_simulate() {
  echo "=== Pipeline simulation (isolated from production) ==="
  command -v docker >/dev/null && docker compose version >/dev/null || { echo "Need Docker Compose v2" >&2; exit 1; }
  require_prod_files

  if [ ! -f .env.simulation ]; then
    cp .env.simulation.example .env.simulation
    echo "Created .env.simulation from example (sim-only credentials)."
  fi

  local sim_health="https://127.0.0.1:${SIM_PORT}/health"
  local teardown=1
  [ "${MEETCON_KEEP_SIM:-0}" = "1" ] && teardown=0

  echo "Removing any previous meetcon-sim stack (frees 127.0.0.1:${SIM_PORT})..."
  "${COMPOSE_SIM[@]}" down --remove-orphans 2>/dev/null || true

  echo "Starting meetcon-sim on 127.0.0.1:${SIM_PORT} (production :$(gateway_port) untouched)..."
  if ! "${COMPOSE_SIM[@]}" up -d --build; then
    "${COMPOSE_SIM[@]}" logs --tail=40 migrate api gateway 2>/dev/null || true
    exit 1
  fi

  local n=0
  while [ "$n" -lt 30 ]; do
    if meetcon_curl_k "$sim_health" 8 2>/dev/null | grep -q '"status":"ok"'; then
      break
    fi
    n=$((n + 1))
    sleep 5
  done
  if [ "$n" -ge 30 ]; then
    echo "Simulation stack health timeout" >&2
    "${COMPOSE_SIM[@]}" logs --tail=60 migrate api gateway 2>/dev/null || true
    [ "$teardown" = 1 ] && "${COMPOSE_SIM[@]}" down 2>/dev/null || true
    exit 1
  fi
  ok_sim() { echo "SIM OK: $*"; }
  ok_sim "stack health $sim_health"

  SIM_BASE_URL="https://127.0.0.1:${SIM_PORT}" SIM_WEB_ORIGIN="https://127.0.0.1:${SIM_PORT}" \
    MEETCON_SMOKE_FULL="${MEETCON_SMOKE_FULL:-1}" run_smoke_test

  if [ "$teardown" = 1 ]; then
    echo "Tearing down simulation stack..."
    "${COMPOSE_SIM[@]}" down 2>/dev/null || true
  else
    echo "MEETCON_KEEP_SIM=1 — simulation stack left running on :${SIM_PORT}"
  fi
  echo "=== Simulation complete ==="
}

cmd_firewall() {
  local port
  port="$(gateway_port)"
  if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow "${port}/tcp" || ufw allow "${port}/tcp"
    ufw status | grep "${port}/tcp" || true
  else
    echo "Open TCP ${port} in your cloud firewall / security group."
  fi
}

cmd_run() {
  if truthy_isolated_sim "${MEETCON_ISOLATED_SIM:-}"; then
    cmd_simulate
  else
    cmd_deploy
    cmd_doctor
    if [ "${MEETCON_SKIP_SMOKE:-0}" != "1" ]; then
      cmd_smoke
    fi
  fi
}

truthy_isolated_sim() {
  case "${1:-}" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac
}

cmd_help() {
  cat <<EOF
MeetCon deploy CLI (small-team production on Docker, port 30098)

  ./deploy/meetcon.sh run         deploy + doctor + smoke on :30098 (MEETCON_ISOLATED_SIM=1 for :30998 stack)
  ./deploy/meetcon.sh smoke       health + SPA on production gateway (MEETCON_SMOKE_FULL=1 for register test)
  ./deploy/meetcon.sh up          docker compose up (manual)
  ./deploy/meetcon.sh deploy      backup + up + health
  ./deploy/meetcon.sh backup      PostgreSQL dump to backups/
  ./deploy/meetcon.sh doctor      quick health + port checks
  ./deploy/meetcon.sh doctor --full   full stack validation script
  ./deploy/meetcon.sh simulate    isolated stack :30998 + app smoke (pre-prod)
  ./deploy/meetcon.sh firewall    ufw allow gateway port (optional)
  ./deploy/meetcon.sh toolchain   Node + pnpm on host (optional; Docker builds by default)

Jenkins: bash deploy/jenkins-ci.sh   (or pipeline stage Run)
EOF
}

meetcon_main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    toolchain) cmd_toolchain ;;
    run|release) cmd_run ;;
    smoke) cmd_smoke ;;
    up) cmd_up "$@" ;;
    deploy) cmd_deploy ;;
    backup) cmd_backup ;;
    doctor|check) cmd_doctor "$@" ;;
    simulate|sim) cmd_simulate ;;
    firewall) cmd_firewall ;;
    help|-h|--help) cmd_help ;;
    *)
      echo "Unknown command: $cmd" >&2
      cmd_help
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  meetcon_main "$@"
fi
