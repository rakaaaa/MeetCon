#!/usr/bin/env sh
# Internal / lab HTTPS for port 30098 (browser will warn unless you trust the cert).
# Production with a public hostname: use your CA or DNS-01 ACME instead.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"

CN="${1:-meetcon.local}"
DAYS="${2:-825}"

if printf '%s' "$CN" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  SAN="IP:${CN},IP:127.0.0.1,DNS:localhost"
else
  SAN="DNS:${CN},DNS:localhost,IP:127.0.0.1"
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout privkey.pem \
  -out fullchain.pem \
  -days "$DAYS" \
  -subj "/CN=${CN}" \
  -addext "subjectAltName=${SAN}"

chmod 600 privkey.pem
chmod 644 fullchain.pem
echo "Wrote fullchain.pem and privkey.pem for CN=${CN}"
echo "Certificate CN=${CN}. Public WEB_ORIGIN stays https://${CN} with no port. Docker listens on 30098."
