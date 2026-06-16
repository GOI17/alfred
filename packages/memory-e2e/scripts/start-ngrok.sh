#!/usr/bin/env bash
set -euo pipefail

# Start an ngrok tunnel pointing to the local Memory API.
# Requires: ngrok installed and NGROK_AUTHTOKEN in the environment.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

if [ -z "${NGROK_AUTHTOKEN:-}" ]; then
  echo "ERROR: NGROK_AUTHTOKEN is not set. Add it to packages/memory-e2e/.env"
  exit 1
fi

echo "Starting ngrok tunnel to localhost:${MEMORY_API_PORT:-8080}"
if [ -n "${NGROK_DOMAIN:-}" ]; then
  ngrok http "${NGROK_AUTHTOKEN}" --domain="$NGROK_DOMAIN" "${MEMORY_API_PORT:-8080}"
else
  ngrok http "${NGROK_AUTHTOKEN}" "${MEMORY_API_PORT:-8080}"
fi
