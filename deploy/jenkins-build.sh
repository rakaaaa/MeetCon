#!/usr/bin/env bash
# Jenkins Build stage: Node/pnpm toolchain + install + typecheck + build.
# Run from repo root: bash deploy/jenkins-build.sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "${ROOT}/deploy/meetcon.sh"
cmd_toolchain

pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
