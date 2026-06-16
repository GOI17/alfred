#!/usr/bin/env bash
set -euo pipefail

# One-command setup for the Alfred Memory E2E environment.
# Requires: docker, docker compose.
# psql is optional; migrations fall back to Node.js + pg.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ ! -f .env ]; then
  echo "Creating .env from .env.example. Please review and edit secrets."
  cp .env.example .env
fi

source .env 2>/dev/null || true

echo "Starting PostgreSQL..."
docker compose -f config/docker-compose.yml up -d --wait

echo "Running migrations..."
"$SCRIPT_DIR/run-migrations.sh"

echo ""
echo "E2E environment is ready."
echo ""
echo "Next steps:"
echo "  1. Review .env and set real secrets/keys."
echo "  2. Start the API: pnpm --filter @alfred-labs/memory-e2e start"
echo "  3. Start a tunnel: pnpm --filter @alfred-labs/memory-e2e tunnel:cloudflare"
echo "     or: pnpm --filter @alfred-labs/memory-e2e tunnel:ngrok"
echo "  4. Run smoke tests: pnpm --filter @alfred-labs/memory-e2e smoke:codex"
echo "     or: pnpm --filter @alfred-labs/memory-e2e smoke:chatgpt"
echo ""
