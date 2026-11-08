#!/usr/bin/env bash
# Build inside Docker — no Node/pnpm on the Jenkins host (only Docker required).
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${MEETCON_CI_IMAGE:-node:20-bookworm}"
PNPM_VER="${PNPM_VERSION:-10.17.1}"

command -v docker >/dev/null || { echo "Install Docker on the Jenkins host." >&2; exit 1; }

mkdir -p "${ROOT}/.pnpm-store-ci"

echo "CI build image: ${IMAGE}"

docker run --rm \
  -e "CI=true" \
  -e "PNPM_VERSION=${PNPM_VER}" \
  -e "COREPACK_ENABLE_DOWNLOAD_PROMPT=0" \
  -u "$(id -u):$(id -g)" \
  -v "${ROOT}:/repo" \
  -w /repo \
  "${IMAGE}" \
  bash -lc "
    set -eu
    corepack enable
    corepack prepare \"pnpm@\${PNPM_VERSION}\" --activate
    pnpm config set store-dir /repo/.pnpm-store-ci
    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm build
  "

echo "Docker CI build finished."
