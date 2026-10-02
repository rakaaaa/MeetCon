#!/usr/bin/env sh
# Internal / lab HTTPS for port 30098 (browser will warn unless you trust the cert).
# Production with a public hostname: use your CA or DNS-01 ACME instead.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"

CN="${1:-meetcon.local}"
DAYS="${2:-825}"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout privkey.pem \
  -out fullchain.pem \
  -days "$DAYS" \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=DNS:${CN},IP:127.0.0.1"

chmod 600 privkey.pem
chmod 644 fullchain.pem
echo "Wrote fullchain.pem and privkey.pem for CN=${CN}"
echo "Set WEB_ORIGIN=https://${CN}:30098 (or https://127.0.0.1:30098 for local tests)."
