#!/usr/bin/env bash
# Run meetcon.sh from repo root (safe when Jenkins cwd or @tmp scripts differ).
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
chmod +x "${ROOT}/deploy/meetcon.sh" 2>/dev/null || true
exec "${ROOT}/deploy/meetcon.sh" "$@"
