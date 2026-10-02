#!/usr/bin/env bash
# Node + pnpm only. Prefer: bash deploy/jenkins-build.sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/deploy/meetcon.sh"
cmd_toolchain
