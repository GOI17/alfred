#!/usr/bin/env bash
set -euo pipefail

# Start a Cloudflare Tunnel pointing to the local Memory API.
# Requires: cloudflared installed and CF_TUNNEL_TOKEN in the environment.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

if [ -z "${CF_TUNNEL_TOKEN:-}" ]; then
  echo "ERROR: CF_TUNNEL_TOKEN is not set. Add it to packages/memory-e2e/.env"
  exit 1
fi

if [ -z "${CF_TUNNEL_HOSTNAME:-}" ]; then
  echo "ERROR: CF_TUNNEL_HOSTNAME is not set. Add it to packages/memory-e2e/.env"
  exit 1
fi

echo "Starting cloudflared tunnel to ${CF_TUNNEL_HOSTNAME} → localhost:${MEMORY_API_PORT:-8080}"
cloudflared tunnel --no-autoupdate run --token "$CF_TUNNEL_TOKEN" --url "http://localhost:${MEMORY_API_PORT:-8080}"
